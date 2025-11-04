const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// ------------------ PATHS ------------------
const IMAGES_DIR = path.join(__dirname, "../images");
const OVERLAYS_DIR = path.join(__dirname, "../overlays");
const DATA_FILE = path.join(__dirname, "nodes.json");

const BASE_IMAGE = path.join(IMAGES_DIR, "base.qcow2");
const ROUTER_IMAGE = path.join(IMAGES_DIR, "router.qcow2");

if (!fs.existsSync(OVERLAYS_DIR))
    fs.mkdirSync(OVERLAYS_DIR, { recursive: true });

// ------------------ STATE ------------------
let nodes = [];
let counters = { pc: 0, router: 0 };

// start fresh each time
nodes = [];
counters = { pc: 0, router: 0 };
saveState();
console.log("🧹 Cleared stale nodes, starting fresh");

// ------------------ HELPERS ------------------
function saveState() {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ nodes, counters }, null, 2));
}

function uniqueName(type) {
    const prefix = type === "router" ? "Router" : "PC";
    counters[type]++;
    return `${prefix} ${counters[type]}`;
}

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        require("child_process").exec(cmd, (err, stdout, stderr) => {
            if (err) reject(stderr || err.message);
            else resolve(stdout);
        });
    });
}

async function detectFormat(imagePath) {
    const info = await runCommand(`qemu-img info --output=json "${imagePath}"`);
    return JSON.parse(info).format || "qcow2";
}

function getDefaultInterfaces(type) {
    return type === "router"
        ? ["GigabitEthernet0/0", "GigabitEthernet0/1"]
        : ["eth0"];
}

async function safeDelete(file) {
    if (!fs.existsSync(file)) return;
    try {
        fs.unlinkSync(file);
    } catch (err) {
        if (err.code === "EBUSY") {
            console.warn(`⚠️ File busy, killing QEMU and retrying...`);
            execSync(
                `wmic process where "name='qemu-system-x86_64.exe'" delete`,
                {
                    stdio: "ignore",
                }
            );
            await new Promise((r) => setTimeout(r, 1000));
            fs.unlinkSync(file);
        }
    }
}

// ------------------ GUAC SETUP ------------------
const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "guacamole_db",
    user: "guacamole_user",
    password: "guacadmin",
});

async function registerVncConnection(nodeName, vncPort) {
    try {
        const res = await pool.query(
            `INSERT INTO guacamole_connection (connection_name, protocol)
       VALUES ($1, 'vnc') RETURNING connection_id`,
            [nodeName]
        );
        const connId = res.rows[0].connection_id;

        const params = [
            [connId, "hostname", "host.docker.internal"],
            [connId, "port", String(vncPort)],
            [connId, "password", ""],
        ];

        for (const [cid, key, val] of params) {
            await pool.query(
                `INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value)
         VALUES ($1, $2, $3)`,
                [cid, key, val]
            );
        }

        console.log(`🟢 Registered ${nodeName} → port ${vncPort}`);
        return connId;
    } catch (err) {
        console.error("❌ Guac registration failed:", err.message);
        return null;
    }
}

async function deleteVncConnectionByName(name) {
    try {
        await pool.query(
            `DELETE FROM guacamole_connection WHERE connection_name = $1`,
            [name]
        );
        console.log(`🗑 Deleted Guac entry for ${name}`);
    } catch (err) {
        console.error(`⚠️ Guac deletion failed: ${err.message}`);
    }
}

// ------------------ ROUTES ------------------
app.get("/nodes", (_, res) => res.json(nodes));

// ---- CREATE NODE ----
app.post("/nodes", async (req, res) => {
    try {
        const { deviceType } = req.body;
        if (!deviceType)
            return res.status(400).json({ error: "deviceType required" });

        const id = uuidv4();
        const baseImage = deviceType === "router" ? ROUTER_IMAGE : BASE_IMAGE;
        if (!fs.existsSync(baseImage))
            return res
                .status(400)
                .json({ error: `Base image missing: ${baseImage}` });

        const overlayPath = path.join(OVERLAYS_DIR, `${id}.qcow2`);
        const format = await detectFormat(baseImage);
        await runCommand(
            `qemu-img create -f qcow2 -b "${baseImage}" -F ${format} "${overlayPath}"`
        );

        const name = uniqueName(deviceType) || `${deviceType}_${Date.now()}`;
        const node = {
            id,
            name,
            deviceType,
            overlayPath,
            status: "stopped",
            vncPort: null,
            guacamoleUrl: null,
            interfaces: getDefaultInterfaces(deviceType),
        };
        nodes.push(node);
        saveState();
        console.log(`🆕 Created ${deviceType}: ${name}`);
        res.status(201).json(node);
    } catch (err) {
        console.error("❌ Node creation failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// ---- RUN NODE ----
app.post("/nodes/:id/run", async (req, res) => {
    try {
        const node = nodes.find((n) => n.id === req.params.id);
        if (!node) return res.status(404).json({ error: "Node not found" });

        // if overlay got deleted → rebuild it
        if (!fs.existsSync(node.overlayPath)) {
            console.warn(`⚠️ Overlay missing for ${node.name}, rebuilding...`);
            const base =
                node.deviceType === "router" ? ROUTER_IMAGE : BASE_IMAGE;
            const format = await detectFormat(base);
            await runCommand(
                `qemu-img create -f qcow2 -b "${base}" -F ${format} "${node.overlayPath}"`
            );
        }

        const display = Math.floor(Math.random() * 50) + 1;
        const vncPort = 5900 + display;
        const qemuArgs = [
            "-hda",
            node.overlayPath,
            "-m",
            node.deviceType === "router" ? "512" : "256",
            "-vnc",
            `:${display}`,
            "-nographic",
        ];
        spawn("qemu-system-x86_64", qemuArgs, {
            detached: true,
            stdio: "ignore",
        }).unref();

        await new Promise((r) => setTimeout(r, 1200));
        const connId = await registerVncConnection(node.name, vncPort);

        node.status = "running";
        node.vncPort = vncPort;
        node.guacamoleUrl = connId
            ? `http://localhost:8080/guacamole/#/client/c/${Buffer.from(
                  `${connId}\0postgres`
              ).toString("base64")}`
            : null;
        saveState();

        console.log(`▶ ${node.name} running on VNC ${vncPort}`);
        return res.status(200).json({
            ...node,
            guacamoleUrl: node.guacamoleUrl,
            vncPort: node.vncPort,
            status: node.status,
        });
    } catch (err) {
        console.error("❌ Run failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// ---- STOP NODE ----
app.post("/nodes/:id/stop", async (req, res) => {
    const node = nodes.find((n) => n.id === req.params.id);
    if (!node) return res.status(404).json({ error: "Node not found" });

    try {
        execSync(`wmic process where "name='qemu-system-x86_64.exe'" delete`, {
            stdio: "ignore",
        });
    } catch {}
    await deleteVncConnectionByName(node.name);

    node.status = "stopped";
    node.vncPort = null;
    node.guacamoleUrl = null;
    saveState();
    console.log(`⏹ Stopped ${node.name}`);
    res.json(node);
});

// ---- WIPE NODE ----
app.post("/nodes/:id/wipe", async (req, res) => {
    const node = nodes.find((n) => n.id === req.params.id);
    if (!node) return res.status(404).json({ error: "Node not found" });

    try {
        await safeDelete(node.overlayPath);
        const base = node.deviceType === "router" ? ROUTER_IMAGE : BASE_IMAGE;
        const format = await detectFormat(base);
        await runCommand(
            `qemu-img create -f qcow2 -b "${base}" -F ${format} "${node.overlayPath}"`
        );
        await deleteVncConnectionByName(node.name);

        node.status = "stopped";
        node.vncPort = null;
        node.guacamoleUrl = null;
        saveState();

        console.log(`🔄 Wiped ${node.name}`);
        res.json(node);
    } catch (err) {
        console.error("❌ Wipe failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// ---- DELETE NODE ----
app.delete("/nodes/:id", async (req, res) => {
    const idx = nodes.findIndex((n) => n.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: "Node not found" });

    const node = nodes[idx];
    try {
        execSync(`wmic process where "name='qemu-system-x86_64.exe'" delete`, {
            stdio: "ignore",
        });
    } catch {}
    await deleteVncConnectionByName(node.name);
    await safeDelete(node.overlayPath);

    nodes.splice(idx, 1);
    saveState();
    console.log(`🗑 Deleted ${node.name}`);
    res.json({ message: "Deleted" });
});

// ------------------ START SERVER ------------------
app.listen(PORT, () =>
    console.log(`✅ Backend running on http://localhost:${PORT}`)
);
