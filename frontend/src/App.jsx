import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import ReactFlow, {
    Background,
    Controls,
    MiniMap,
    addEdge,
    useNodesState,
    useEdgesState,
    Handle,
    Position,
} from "react-flow-renderer";
import "./App.css";
import routerImg from "./images/router.png";
import pcImg from "./images/pc.png";

const API_URL = "http://localhost:3001";

const devicePalette = [
    { type: "router", label: "Router", icon: "⚙️" },
    { type: "pc", label: "PC", icon: "🖥️" },
];

export default function App() {
    const [view, setView] = useState("home");
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [contextMenu, setContextMenu] = useState(null);
    const [linkMode, setLinkMode] = useState(false);
    const [selectedEndpoints, setSelectedEndpoints] = useState([]);
    const [showInterfaceModal, setShowInterfaceModal] = useState(null);
    const reactFlowWrapper = useRef(null);

    // Load nodes from backend
    useEffect(() => {
        fetch(`${API_URL}/nodes`)
            .then((res) => res.json())
            .then((data) => {
                const formatted = data.map((n, i) => ({
                    id: n.id,
                    type: n.deviceType,
                    position: { x: 150 * i, y: 100 },
                    data: n,
                }));
                setNodes(formatted);
            })
            .catch(() => {});
    }, []);

    const handleAction = async (action, nodeId) => {
        try {
            const res = await fetch(`${API_URL}/nodes/${nodeId}/${action}`, {
                method: "POST",
            });
            const updated = await res.json();
            setNodes((nds) =>
                nds.map((n) => (n.id === nodeId ? { ...n, data: updated } : n))
            );
        } catch (e) {
            console.error(e);
        }
    };

    const deleteNode = async (nodeId) => {
        await fetch(`${API_URL}/nodes/${nodeId}`, { method: "DELETE" });
        setNodes((nds) => nds.filter((n) => n.id !== nodeId));
        setEdges((eds) =>
            eds.filter((e) => e.source !== nodeId && e.target !== nodeId)
        );
    };

    // Handle drag-drop creation
    const onDrop = useCallback(
        async (event) => {
            event.preventDefault();
            const type = event.dataTransfer.getData("application/reactflow");
            if (!type) return;

            const bounds = reactFlowWrapper.current.getBoundingClientRect();
            const position = {
                x: event.clientX - bounds.left - 40,
                y: event.clientY - bounds.top - 40,
            };

            const res = await fetch(`${API_URL}/nodes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ deviceType: type }),
            });
            const node = await res.json();

            setNodes((nds) =>
                nds.concat({
                    id: node.id,
                    type,
                    position,
                    data: node,
                })
            );
        },
        [setNodes]
    );

    const onDragOver = useCallback((e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }, []);

    // ========== Cable Mode ==========
    const handleDeviceClick = (node) => {
        if (!linkMode) {
            if (node.data.status === "running" && node.data.guacamoleUrl) {
                window.open(node.data.guacamoleUrl, "_blank");
            }
            return;
        }

        const interfaces =
            node.type === "router"
                ? ["GigabitEthernet0/0", "GigabitEthernet0/1"]
                : ["eth0"];

        const usedIfaces = edges
            .filter((e) => e.source === node.id || e.target === node.id)
            .map((e) =>
                e.source === node.id ? e.sourceHandle : e.targetHandle
            );

        const freeIfaces = interfaces.map((iface) => ({
            name: iface,
            used: usedIfaces.includes(iface),
        }));

        setShowInterfaceModal({ node, freeIfaces });
    };

    const chooseInterface = (iface) => {
        if (!showInterfaceModal) return;
        const { node } = showInterfaceModal;
        const newSel = [...selectedEndpoints, { nodeId: node.id, iface }];
        setShowInterfaceModal(null);

        if (newSel.length === 2) {
            const [a, b] = newSel;
            const newEdge = {
                id: `edge-${a.nodeId}-${b.nodeId}-${Date.now()}`,
                source: a.nodeId,
                target: b.nodeId,
                sourceHandle: a.iface,
                targetHandle: b.iface,
                type: "smoothstep",
                animated: true,
                style: { stroke: "#00d4ff", strokeWidth: 2 },
                label: `${a.iface} ↔ ${b.iface}`,
                labelBgStyle: { fill: "#000", color: "#fff", opacity: 0.7 },
            };

            setEdges((eds) => [...eds, newEdge]);
            setSelectedEndpoints([]);
            setLinkMode(false);
            document.body.style.cursor = "default";
        } else {
            setSelectedEndpoints(newSel);
        }
    };

    const toggleCableMode = () => {
        const newMode = !linkMode;
        setLinkMode(newMode);
        document.body.style.cursor = newMode ? "crosshair" : "default";
    };

    // ========== Context Menu ==========
    const onNodeContextMenu = useCallback((event, node) => {
        event.preventDefault();
        setContextMenu({ node, x: event.clientX, y: event.clientY });
    }, []);

    const handleMenuAction = async (action) => {
        if (!contextMenu) return;
        const { node } = contextMenu;
        switch (action) {
            case "run":
            case "stop":
            case "wipe":
                await handleAction(action, node.id);
                break;
            case "delete":
                await deleteNode(node.id);
                break;
        }
        setContextMenu(null);
    };

    // ========== Node Components (with invisible Handles) ==========
    const nodeTypes = useMemo(
        () => ({
            router: ({ id, data }) => (
                <div
                    style={{
                        textAlign: "center",
                        color: "#fff",
                        border:
                            data.status === "running"
                                ? "2px solid #10b981"
                                : "2px solid transparent",
                        borderRadius: "12px",
                        padding: "4px",
                        cursor: linkMode ? "crosshair" : "pointer",
                        position: "relative",
                    }}
                    onClick={() =>
                        handleDeviceClick({ id, data, type: "router" })
                    }
                    onContextMenu={(e) => onNodeContextMenu(e, { id, data })}>
                    <img src={routerImg} alt="router" width={80} height={80} />
                    <div>{data.name}</div>

                    {/* Invisible Handles (required for wires to anchor) */}
                    <Handle
                        type="source"
                        position={Position.Left}
                        id="GigabitEthernet0/0"
                        style={{ top: "40%", opacity: 0 }}
                    />
                    <Handle
                        type="source"
                        position={Position.Right}
                        id="GigabitEthernet0/1"
                        style={{ top: "60%", opacity: 0 }}
                    />
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="GigabitEthernet0/0"
                        style={{ top: "40%", opacity: 0 }}
                    />
                    <Handle
                        type="target"
                        position={Position.Right}
                        id="GigabitEthernet0/1"
                        style={{ top: "60%", opacity: 0 }}
                    />
                </div>
            ),
            pc: ({ id, data }) => (
                <div
                    style={{
                        textAlign: "center",
                        color: "#fff",
                        border:
                            data.status === "running"
                                ? "2px solid #10b981"
                                : "2px solid transparent",
                        borderRadius: "12px",
                        padding: "4px",
                        cursor: linkMode ? "crosshair" : "pointer",
                        position: "relative",
                    }}
                    onClick={() => handleDeviceClick({ id, data, type: "pc" })}
                    onContextMenu={(e) => onNodeContextMenu(e, { id, data })}>
                    <img src={pcImg} alt="pc" width={70} height={70} />
                    <div>{data.name}</div>

                    <Handle
                        type="source"
                        position={Position.Right}
                        id="eth0"
                        style={{ top: "50%", opacity: 0 }}
                    />
                    <Handle
                        type="target"
                        position={Position.Left}
                        id="eth0"
                        style={{ top: "50%", opacity: 0 }}
                    />
                </div>
            ),
        }),
        [linkMode, edges]
    );

    // ========== UI ==========
    return (
        <div className="App">
            {view === "home" && (
                <div className="home-container">
                    <header className="header">
                        <h1>Network Lab</h1>
                        <p>Design and simulate your virtual network</p>
                    </header>

                    <div className="create-section">
                        <button
                            onClick={() => setView("topology")}
                            className="btn-create">
                            🧩 Open Topology Builder
                        </button>
                    </div>
                </div>
            )}

            {view === "topology" && (
                <div className="topology-fullscreen" ref={reactFlowWrapper}>
                    <div className="topbar">
                        <button
                            className="btn-home"
                            onClick={() => setView("home")}>
                            🏠 Home
                        </button>
                        <button
                            className={`btn-cable ${linkMode ? "active" : ""}`}
                            onClick={toggleCableMode}>
                            {linkMode
                                ? "🟡 Cable Mode ON"
                                : "⚪ Cable Mode OFF"}
                        </button>
                    </div>

                    <div className="palette">
                        <h3>Devices</h3>
                        {devicePalette.map((item) => (
                            <div
                                key={item.type}
                                className="palette-item"
                                draggable
                                onDragStart={(e) =>
                                    e.dataTransfer.setData(
                                        "application/reactflow",
                                        item.type
                                    )
                                }>
                                <span className="palette-icon">
                                    {item.icon}
                                </span>
                                <span>{item.label}</span>
                            </div>
                        ))}
                    </div>

                    <div className="topology-canvas">
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            nodeTypes={nodeTypes}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onDrop={onDrop}
                            onDragOver={onDragOver}
                            fitView>
                            <Background />
                            <MiniMap />
                            <Controls />
                        </ReactFlow>
                    </div>

                    {contextMenu && (
                        <div
                            className="context-menu"
                            style={{
                                top: contextMenu.y,
                                left: contextMenu.x,
                            }}>
                            <button onClick={() => handleMenuAction("run")}>
                                ▶ Run
                            </button>
                            <button onClick={() => handleMenuAction("stop")}>
                                ⏹ Stop
                            </button>
                            <button onClick={() => handleMenuAction("wipe")}>
                                🔄 Wipe
                            </button>
                            <button onClick={() => handleMenuAction("delete")}>
                                🗑 Delete
                            </button>
                        </div>
                    )}

                    {showInterfaceModal && (
                        <div className="interface-modal">
                            <div className="modal-content">
                                <h3>Select Interface</h3>
                                {showInterfaceModal.freeIfaces.map((iface) => (
                                    <button
                                        key={iface.name}
                                        className="iface-btn"
                                        onClick={() =>
                                            !iface.used &&
                                            chooseInterface(iface.name)
                                        }
                                        disabled={iface.used}
                                        style={{
                                            background: iface.used
                                                ? "#555"
                                                : "#00d4ff",
                                            opacity: iface.used ? 0.6 : 1,
                                            cursor: iface.used
                                                ? "not-allowed"
                                                : "pointer",
                                        }}>
                                        {iface.name}{" "}
                                        {iface.used ? "(in use)" : ""}
                                    </button>
                                ))}
                                <button
                                    onClick={() => setShowInterfaceModal(null)}
                                    style={{ marginTop: "10px" }}>
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
