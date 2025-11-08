const WebSocket = require('ws');
const { EventEmitter } = require('events');
const { error } = require('console');
const { json } = require('stream/consumers');

class WebSocketServer extends EventEmitter {
    constructor(port = 8080, options = {}) {
        super();

        this.port = port;
        this.clients = new Map();
        this.heartbeatInterval = options.heartbeatInterval || 30000;

        this.wss = new WebSocket.Server({
            port: this.port,
            ...options.wsOptions
        });

        this.setupServer();
        console.log(`WebSocket server running on ws://localhost:${this.port}`);
    }

    setupServer() {
        this.wss.on('connection', (ws, req) => {
            const clientId = this.generateClientId();

            this.clients.set(clientId, {
                ws,
                isAlive: true,
                metadata: {
                    connectedAt: Date.now(),
                    ip: req.socket.remoteAddress
                }
            });

            console.log(`Client connected: ${clientId} (Total: ${this.clients.size})`);

            ws.on('pong', () => {
                const client = this.clients.get(clientId);
                if (client) client.isAlive = true;
            });

            ws.on('message', (data) => {
                try {
                    const message = this.parseJSONL(data);
                    this.handleMessage(clientId, message);
                } catch (err) {
                    console.error(`Error parsing message from ${clientId}: `, error.message);
                    this.sendError(clientId, 'Invalid JSON format');
                } 
            });

            ws.on('close', () => {
                this.clients.delete(clientId);
                console.log(`Client disconnected: ${clientId} (Total: ${this.clients.size})`);
                this.emit('clientDisconnected', clientId);
            });

            ws.on('error', (err) => {
                console.error(`WebSocket error for ${clientId}: `, err.message);
            });

            this.send(clientId, {
                type: 'connected',
                clientId,
                timestamp: Date.now()
            });

            this.emit('clientConneccted', clientId);
        });

        this.startHeartbeat();
    }

    generateClientId() {
        return `client_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    }

    parseJSONL(data) {
        const text = data.toString().trim();

        const lines = text.split('\n').filter(line => line.trim());

        if (lines.length === 1) {
            return JSON.parse(lines[0]);
        } else {
            return lines.map(line => json.parse(line));
        }
    }

    handleMessage(clientId, message) {
        if (Array.isArray(message)) {
            message.forEach(msg => this.emit('message', clientId, msg));
            return;
        }

        console.log(`Message rom ${clientId}: `, message);
        this.emit('message', clientId, message);
    }

    send(clientId, data) {
        const client = this.clients.get(clientId);
        if (!client || client.ws.readyState !== WebSocket.OPEN) {
            console.warn(`Cannot send to ${clientId}: client not connected`);
            return false;
        }

        try {
            const jsonl = JSON.stringify(data) + '\n';
            client.ws.send(jsonl);
            return true;
        } catch (err) {
            console.error(`Error sending to ${clientId}: `, err.message);
            return false;
        }
    }

    broadcast(data, excluded = null) {
        const jsonl = JSON.stringify(data) + '\n';
        let sentCount = 0;
        
        this.clients.forEach((client, clientId) => {
        if (clientId !== excluded && client.ws.readyState === WebSocket.OPEN) {
            try {
            client.ws.send(jsonl);
            sentCount++;
            } catch (error) {
            console.error(`Error broadcasting to ${clientId}:`, error.message);
            }
        }
        });
        
        return sentCount;
    }
      
    sendError(clientId, errorMessage) {
        this.send(clientId, {
        type: 'error',
        error: errorMessage,
        timestamp: Date.now()
        });
    }
    
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
        this.clients.forEach((client, clientId) => {
            if (!client.isAlive) {
            console.log(`Terminating inactive client: ${clientId}`);
            client.ws.terminate();
            this.clients.delete(clientId);
            return;
            }
            
            client.isAlive = false;
            client.ws.ping();
        });
        }, this.heartbeatInterval);
    }
    
    getClientMetadata(clientId) {
        const client = this.clients.get(clientId);
        return client ? client.metadata : null;
    }
    
    getConnectedClients() {
        return Array.from(this.clients.keys());
    }
    
    close() {
        clearInterval(this.heartbeatTimer);
        this.wss.close();
        console.log('WebSocket server closed');
    }
}
