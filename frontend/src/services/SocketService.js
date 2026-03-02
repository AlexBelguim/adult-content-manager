
import { io } from "socket.io-client";

const SOCKET_URL = process.env.NODE_ENV === 'production'
    ? window.location.origin
    : window.location.hostname === 'localhost' ? 'http://localhost:4069' : window.location.origin;

class SocketService {
    constructor() {
        this.socket = null;
        this.listeners = new Map();
    }

    connect() {
        if (this.socket) return this.socket;

        this.socket = io(SOCKET_URL, {
            reconnectionDelayMax: 10000,
            transports: ["websocket", "polling"]
        });

        this.socket.on("connect", () => {
            console.log("Socket connected:", this.socket.id);
        });

        this.socket.on("disconnect", () => {
            console.log("Socket disconnected");
        });

        this.socket.on("sync_status", (data) => {
            console.log("Sync status received:", data);
        });

        return this.socket;
    }

    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
    }

    emit(event, data) {
        if (!this.socket) this.connect();
        this.socket.emit(event, data);
    }

    on(event, callback) {
        if (!this.socket) this.connect();
        this.socket.on(event, callback);
    }

    off(event, callback) {
        if (this.socket) {
            this.socket.off(event, callback);
        }
    }
}

export const socketService = new SocketService();
