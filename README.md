# Network Lab


A full-fledged virtual networking lab built using **QEMU**, **React**, **Node.js**, and **Docker**, where you can visually create routers, PCs, and connect them with cables — just like Cisco Packet Tracer.


## Prerequisites

-   Linux
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
curl -o TinyCore.iso https://tinycorelinux.net/15.x/x86/release/TinyCore-current.iso

# Create base disk
qemu-img create -f qcow2 base.qcow2 1G

# Boot and install TinyCore Linux
qemu-system-x86_64 -hda base.qcow2 -cdrom TinyCore.iso -boot d -m 512
```

 Downlaod Router Image by going to the following link
```
wget https://labs.networkgeek.in/router.qcow2

```
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
### Connect Topology 


https://github.com/user-attachments/assets/34f7df86-9b33-4e46-ae55-c7704be636d2


### Create virtual bridges in host machine
```bash
sudo ip link add name br1 type bridge
sudo ip link set br1 up

sudo ip link add name br2 type bridge
sudo ip link set br2 up

```
### Config ip in VM's
```bash
Router> enable
Router# configure terminal
Router(config)#
Router(config)# interface GigabitEthernet0/0
Router(config-if)# ip address 192.168.1.1 255.255.255.0
Router(config-if)# no shutdown
Router(config-if)# exit
Router(config)#
Router(config)# interface GigabitEthernet0/1
Router(config-if)# ip address 192.168.2.1 255.255.255.0
Router(config-if)# no shutdown
Router(config-if)# exit
Router(config)# end
```
```
sudo ifconfig eth0 192.168.1.2 netmask 255.255.255.0 up
sudo route add default gw 192.168.1.1
```
```
sudo ifconfig eth0 192.168.2.2 netmask 255.255.255.0 up
sudo route add default gw 192.168.2.1
```
### Try Pinging

### Access the Application

-   **Dashboard**: http://localhost:5173
-   **Guacamole**: http://localhost:8080/guacamole
    -   Login: `guacadmin` / `guacadmin`

## File Structure

```
network-lab/
├── backend/
│   ├── server.js          # Express backend
│   ├── package.json
│   └── ...
├── frontend/
│   ├── src/
│   │   ├── App.jsx        # React app
│   │   ├── App.css        # Styling
│  .  │   └── ...
│   ├── package.json
│   └── ...
├── images/
│   ├── base.qcow2        # Base VM image
│   ├── router.qcow2      # Cisco router image
│   └── tinycore-*.iso    # TinyCore installer
├── overlays/              # VM disk overlays (auto-created)
├── docker-compose.yml     # Guacamole + PostgreSQL config
├── initdb.sql            # Guacamole database schema
└── README.md```
