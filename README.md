# Network Lab

## Video



https://github.com/user-attachments/assets/d63f9639-d98a-49a1-b8d8-f072307d2725



A modern web-based virtual machine management platform that lets you create, manage, and access VMs directly from your browser using QEMU, VNC, and Guacamole.

## Features

-   **Web Dashboard**: Beautiful, modern UI to manage virtual machines
-   **One-Click VM Creation**: Create new VMs with a single click
-   **Instant VM Access**: Open running VMs in your browser via Guacamole
-   **Auto VNC Registration**: Guacamole connections are created automatically
-   **VM Lifecycle Management**: Run, stop, wipe, and delete nodes
-   **Disk Overlays**: Efficient storage using QEMU copy-on-write overlays
-   **Real-time Status**: Live updates of all node statuses

## Prerequisites

-   Windows 10/11
-   QEMU
-   Docker Desktop
-   Node.js 18+
-   npm

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/network-lab.git
cd network-lab
```

### 2. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 4. Prepare Base VM Image

Download Alpine Linux and set it up as your base image:

```bash
mkdir images
mkdir overlays
cd images

# Download Alpine ISO
curl -o alpine-virt-3.22.2-x86_64.iso https://dl-cdn.alpinelinux.org/alpine/v3.22/releases/x86_64/alpine-virt-3.22.2-x86_64.iso

# Create base disk
qemu-img create -f qcow2 base.qcow2 2G

# Boot and install Alpine
qemu-system-x86_64 -hda base.qcow2 -cdrom alpine-virt-3.22.2-x86_64.iso -boot d -m 512
```

In the Alpine installer:

1. Login as `root` (no password)
2. Run `setup-alpine`
3. Follow the prompts (mostly defaults are fine)
4. When asked about disk, choose `sda` and select `sys` install
5. After installation completes, type `poweroff`

## Usage

### Start Everything

```bash
# Terminal 1: Start Docker
docker-compose up -d

# Wait 30 seconds for services to start

# Terminal 2: Start backend
cd backend
node server.js

# Terminal 3: Start frontend
cd frontend
npm run dev
```

### Access the Application

-   **Dashboard**: http://localhost:5173
-   **Guacamole**: http://localhost:8080/guacamole
    -   Login: `guacadmin` / `guacadmin`

### Creating and Managing Nodes

1. **Create a Node**: Enter a name and click "Add Node"
2. **Run a Node**: Click the green "Run" button
3. **Access Console**: Click the "💻 Console" button to open in Guacamole
4. **Stop Node**: Click the red "Stop" button
5. **Wipe Node**: Click "🔄 Wipe" to reset to base state
6. **Delete Node**: Click "🗑 Delete" to remove permanently

## API Endpoints

### POST /nodes

Create a new node

**Body:**

```json
{
    "name": "my-vm"
}
```

### POST /nodes/:id/run

Start a node

### POST /nodes/:id/stop

Stop a node

### POST /nodes/:id/wipe

Wipe a node (delete overlay, recreate fresh)

### DELETE /nodes/:id

Delete a node permanently

## File Structure

```
network-lab/
├── backend/
│   ├── server.js          # Express backend
│   ├── package.json
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # React app
│   │   ├── App.css        # Styling
│   │   └── ...
│   ├── package.json
│   └── ...
├── images/
│   ├── base.qcow2         # Base VM image
│   └── alpine-virt-*.iso  # Alpine installer
├── overlays/              # VM disk overlays (auto-created)
├── docker-compose.yml     # Guacamole + PostgreSQL config
├── initdb.sql            # Guacamole database schema
└── README.md
```

## How It Works

1. **Base Image**: `base.qcow2` contains Alpine Linux (one-time setup)
2. **Overlays**: Each VM gets a `qcow2` overlay file that tracks only changes
3. **QEMU**: Runs VMs with VNC servers on ports 5900+
4. **Guacamole**: Proxies VNC connections to your browser
5. **Auto-Registration**: Backend automatically registers VNC connections with Guacamole
