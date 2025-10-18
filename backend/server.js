const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;

// PostgreSQL connection to Guacamole database
const pool = new Pool({
    host: "localhost",
    port: 5432,
    database: "guacamole_db",
    user: "guacamole_user",
    password: "guacadmin",
    connectTimeoutMillis: 5000,
});

const nodes = new Map();
const OVERLAYS_DIR = path.join(__dirname, "../overlays");
const BASE_IMAGE = path.join(__dirname, "../images/base.qcow2");

if (!fs.existsSync(OVERLAYS_DIR)) {
    fs.mkdirSync(OVERLAYS_DIR, { recursive: true });
}

// Test database connection on startup
pool.query("SELECT NOW()", (err) => {
    if (err) {
        console.error("Database connection failed:", err.message);
    } else {
        console.log("Connected to Guacamole database");
    }
});

function runCommand(cmd) {
    return new Promise((resolve, reject) => {
        exec(cmd, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr || err.message));
            else resolve(stdout);
        });
    });
}

async function registerVncConnection(nodeName, vncPort) {
    try {
        console.log(`Registering ${nodeName} on port ${vncPort}...`);

        // Insert connection
        const connResult = await pool.query(
            "INSERT INTO guacamole_connection (connection_name, protocol) VALUES ($1, $2) RETURNING connection_id",
            [nodeName, "vnc"]
        );

        const connId = connResult.rows[0].connection_id;
        console.log(`Created connection ID: ${connId}`);

        // Insert parameters
        const params = [
            [connId, "hostname", "host.docker.internal"],
            [connId, "port", String(vncPort)],
            [connId, "password", ""],
        ];

        for (const [id, name, value] of params) {
            await pool.query(
                "INSERT INTO guacamole_connection_parameter (connection_id, parameter_name, parameter_value) VALUES ($1, $2, $3)",
                [id, name, value]
            );
        }

        console.log(`✓ Registered: ${nodeName} -> port ${vncPort}`);
        return connId;
    } catch (err) {
        console.error(`✗ Registration failed:`, err.message);
        return null;
    }
}

async function deleteVncConnection(nodeName) {
    try {
        await pool.query(
            "DELETE FROM guacamole_connection WHERE connection_name = $1",
            [nodeName]
        );
        console.log(`✓ Deleted: ${nodeName}`);
    } catch (err) {
        console.error(`✗ Delete failed:`, err.message);
    }
}

function findAvailableVncPort() {
    const used = Array.from(nodes.values())
        .filter((n) => n.status === "running")
        .map((n) => n.vncDisplay);

    for (let d = 0; d < 100; d++) {
        if (!used.includes(d)) return d;
    }
    throw new Error("No available VNC ports");
}

app.get("/nodes", (req, res) => {
    res.json(Array.from(nodes.values()));
});

app.post("/nodes", async (req, res) => {
    try {
        const id = uuidv4();
        const name = req.body.name || `node-${id.slice(0, 8)}`;
        const overlayPath = path.join(OVERLAYS_DIR, `${id}.qcow2`);

        await runCommand(
            `qemu-img create -f qcow2 -b "${BASE_IMAGE}" -F qcow2 "${overlayPath}"`
        );

        const node = {
            id,
            name,
            overlayPath,
            status: "stopped",
            vncPort: null,
            vncDisplay: null,
        };

        nodes.set(id, node);
        res.status(201).json(node);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/nodes/:id/run", async (req, res) => {
    try {
        const { id } = req.params;
        const node = nodes.get(id);

        if (!node) return res.status(404).json({ error: "Node not found" });
        if (node.status === "running")
            return res.status(400).json({ error: "Already running" });

        const vncDisplay = findAvailableVncPort();
        const vncPort = 5900 + vncDisplay;

        const proc = spawn(
            "qemu-system-x86_64",
            [
                "-hda",
                node.overlayPath,
                "-m",
                "256",
                "-vnc",
                `:${vncDisplay}`,
                "-nographic",
            ],
            { detached: true, stdio: "ignore" }
        );

        proc.unref();
        fs.writeFileSync(
            path.join(OVERLAYS_DIR, `${id}.pid`),
            String(proc.pid)
        );

        await new Promise((r) => setTimeout(r, 1500));

        const connId = await registerVncConnection(node.name, vncPort);

        node.status = "running";
        node.vncPort = vncPort;
        node.vncDisplay = vncDisplay;
        node.guacamoleUrl = connId
            ? `http://localhost:8080/guacamole/#/client/c/${Buffer.from(
                  `${connId}\0postgres`
              ).toString("base64")}`
            : `http://localhost:8080/guacamole`;

        res.json(node);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/nodes/:id/stop", async (req, res) => {
    try {
        const { id } = req.params;
        const node = nodes.get(id);

        if (!node) return res.status(404).json({ error: "Node not found" });
        if (node.status === "stopped")
            return res.status(400).json({ error: "Already stopped" });

        const pidFile = path.join(OVERLAYS_DIR, `${id}.pid`);
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim());
            try {
                process.kill(pid, "SIGTERM");
                fs.unlinkSync(pidFile);
            } catch (e) {}
        }

        await deleteVncConnection(node.name);

        node.status = "stopped";
        node.vncPort = null;
        node.vncDisplay = null;
        node.guacamoleUrl = null;

        res.json(node);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post("/nodes/:id/wipe", async (req, res) => {
    try {
        const { id } = req.params;
        const node = nodes.get(id);

        if (!node) return res.status(404).json({ error: "Node not found" });

        if (node.status === "running") {
            const pidFile = path.join(OVERLAYS_DIR, `${id}.pid`);
            if (fs.existsSync(pidFile)) {
                const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim());
                try {
                    process.kill(pid, "SIGTERM");
                } catch (e) {}
                fs.unlinkSync(pidFile);
            }
            await deleteVncConnection(node.name);
        }

        if (fs.existsSync(node.overlayPath)) fs.unlinkSync(node.overlayPath);
        await runCommand(
            `qemu-img create -f qcow2 -b "${BASE_IMAGE}" -F qcow2 "${node.overlayPath}"`
        );

        node.status = "stopped";
        node.vncPort = null;
        node.vncDisplay = null;
        node.guacamoleUrl = null;

        res.json({ message: "Wiped", node });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/nodes/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const node = nodes.get(id);

        if (!node) return res.status(404).json({ error: "Node not found" });

        if (node.status === "running") {
            const pidFile = path.join(OVERLAYS_DIR, `${id}.pid`);
            if (fs.existsSync(pidFile)) {
                const pid = parseInt(fs.readFileSync(pidFile, "utf8").trim());
                try {
                    process.kill(pid, "SIGTERM");
                } catch (e) {}
                fs.unlinkSync(pidFile);
            }
            await deleteVncConnection(node.name);
        }

        if (fs.existsSync(node.overlayPath)) fs.unlinkSync(node.overlayPath);
        nodes.delete(id);

        res.json({ message: "Deleted" });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Backend running on http://localhost:${PORT}`);
});
