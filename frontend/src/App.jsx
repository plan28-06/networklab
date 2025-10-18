import { useState, useEffect } from "react";
import "./App.css";

const API_URL = "http://localhost:3001";

function App() {
    const [nodes, setNodes] = useState([]);
    const [nodeName, setNodeName] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        fetchNodes();
        const interval = setInterval(fetchNodes, 2000);
        return () => clearInterval(interval);
    }, []);

    async function fetchNodes() {
        try {
            const res = await fetch(`${API_URL}/nodes`);
            const data = await res.json();
            setNodes(data);
        } catch (error) {
            console.error("Fetch failed:", error);
        }
    }

    async function createNode() {
        if (!nodeName.trim()) {
            alert("Enter a node name");
            return;
        }

        setLoading(true);
        try {
            await fetch(`${API_URL}/nodes`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name: nodeName }),
            });
            setNodeName("");
            fetchNodes();
        } catch (error) {
            alert("Failed to create node");
        }
        setLoading(false);
    }

    async function runNode(id) {
        try {
            await fetch(`${API_URL}/nodes/${id}/run`, { method: "POST" });
            fetchNodes();
        } catch (error) {
            alert("Failed to start node");
        }
    }

    async function stopNode(id) {
        try {
            await fetch(`${API_URL}/nodes/${id}/stop`, { method: "POST" });
            fetchNodes();
        } catch (error) {
            alert("Failed to stop node");
        }
    }

    async function wipeNode(id) {
        if (!confirm("Reset this node?")) return;
        try {
            await fetch(`${API_URL}/nodes/${id}/wipe`, { method: "POST" });
            fetchNodes();
        } catch (error) {
            alert("Failed to wipe node");
        }
    }

    async function deleteNode(id) {
        if (!confirm("Delete permanently?")) return;
        try {
            await fetch(`${API_URL}/nodes/${id}`, { method: "DELETE" });
            fetchNodes();
        } catch (error) {
            alert("Failed to delete node");
        }
    }

    function openConsole(node) {
        if (node.guacamoleUrl) {
            window.open(node.guacamoleUrl, "_blank");
        }
    }

    return (
        <div className="App">
            <div className="header">
                <h1>Network Lab</h1>
                <p>Create and manage virtual machines</p>
            </div>

            <div className="create-section">
                <div className="input-group">
                    <input
                        type="text"
                        placeholder="Node name..."
                        value={nodeName}
                        onChange={(e) => setNodeName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && createNode()}
                        disabled={loading}
                    />
                    <button
                        onClick={createNode}
                        disabled={loading}
                        className="btn-create">
                        {loading ? "⏳ Creating..." : "➕ Add Node"}
                    </button>
                </div>
            </div>

            <div className="nodes-container">
                {nodes.length === 0 ? (
                    <div className="empty">
                        <p className="empty-icon">🖥️</p>
                        <p>No nodes yet</p>
                        <p className="empty-sub">
                            Create one above to get started
                        </p>
                    </div>
                ) : (
                    <div className="grid">
                        {nodes.map((node) => (
                            <div
                                key={node.id}
                                className={`card ${node.status}`}>
                                <div className="card-top">
                                    <div className="node-icon">
                                        {node.status === "running"
                                            ? "🟢"
                                            : "⚪"}
                                    </div>
                                    <div className="node-info">
                                        <h3>{node.name}</h3>
                                        <span className="status">
                                            {node.status}
                                        </span>
                                    </div>
                                </div>

                                <div className="card-middle">
                                    {node.status === "running" && (
                                        <div className="port-info">
                                            Port: {node.vncPort}
                                        </div>
                                    )}
                                </div>

                                <div className="card-actions">
                                    {node.status === "stopped" ? (
                                        <button
                                            onClick={() => runNode(node.id)}
                                            className="btn btn-run">
                                            ▶ Run
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => openConsole(node)}
                                            className="btn btn-console"
                                            title="Open in Guacamole">
                                            💻 Console
                                        </button>
                                    )}

                                    {node.status === "running" && (
                                        <button
                                            onClick={() => stopNode(node.id)}
                                            className="btn btn-stop">
                                            ⏹ Stop
                                        </button>
                                    )}

                                    <button
                                        onClick={() => wipeNode(node.id)}
                                        className="btn btn-wipe">
                                        🔄 Wipe
                                    </button>

                                    <button
                                        onClick={() => deleteNode(node.id)}
                                        className="btn btn-delete">
                                        🗑 Delete
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
