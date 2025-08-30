import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server as SocketIOServer } from 'socket.io';

const dev = process.env.NODE_ENV !== 'production';
const hostname = 'localhost';
const port = parseInt(process.env.PORT || '3000', 10);

// Initialize Next.js app
const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// Player state interface
interface PlayerState {
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  videoId: string;
  title: string;
}

// Queue item interface
interface QueueItem {
  id: string;
  videoId: string;
  title: string;
  addedBy: string;
  addedAt: Date;
}

// Room state interface
interface RoomState {
  player: PlayerState;
  queue: QueueItem[];
  connectedUsers: string[];
}

// Global room states storage
const rooms: Map<string, RoomState> = new Map();

// Initialize default room state
const initializeRoom = (roomId: string): RoomState => ({
  player: {
    isPlaying: false,
    currentTime: 0,
    duration: 0,
    videoId: '',
    title: ''
  },
  queue: [],
  connectedUsers: []
});

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      console.error('Error occurred handling request:', err);
      res.statusCode = 500;
      res.end('Internal Server Error');
    }
  });

  // Initialize Socket.IO server
  const io = new SocketIOServer(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  // Handle Socket.IO connections
  io.on('connection', (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join room event
    socket.on('join_room', (roomId: string) => {
      socket.join(roomId);
      
      // Initialize room if it doesn't exist
      if (!rooms.has(roomId)) {
        rooms.set(roomId, initializeRoom(roomId));
      }
      
      const room = rooms.get(roomId)!;
      room.connectedUsers.push(socket.id);
      
      // Send current room state to the joining user
      socket.emit('room_state', room);
      
      console.log(`User ${socket.id} joined room ${roomId}`);
    });

    // Player command event
    socket.on('player_command', (data: {
      roomId: string;
      action: string;
      payload?: any;
    }) => {
      const { roomId, action, payload } = data;
      const room = rooms.get(roomId);
      
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }

      // Process player command and update state
      switch (action) {
        case 'play':
          room.player.isPlaying = true;
          break;
        case 'pause':
          room.player.isPlaying = false;
          break;
        case 'seek':
          if (payload && typeof payload.time === 'number') {
            room.player.currentTime = payload.time;
          }
          break;
        case 'load_video':
          if (payload && payload.videoId) {
            room.player.videoId = payload.videoId;
            room.player.title = payload.title || '';
            room.player.currentTime = 0;
            room.player.isPlaying = false;
          }
          break;
        case 'time_update':
          if (payload && typeof payload.currentTime === 'number') {
            room.player.currentTime = payload.currentTime;
          }
          if (payload && typeof payload.duration === 'number') {
            room.player.duration = payload.duration;
          }
          break;
      }

      // Broadcast updated state to all clients in the room
      io.to(roomId).emit('player_state_update', room.player);
      console.log(`Player command processed: ${action} in room ${roomId}`);
    });

    // Queue command event
    socket.on('queue_command', (data: {
      roomId: string;
      action: string;
      payload?: any;
    }) => {
      const { roomId, action, payload } = data;
      const room = rooms.get(roomId);
      
      if (!room) {
        socket.emit('error', 'Room not found');
        return;
      }

      switch (action) {
        case 'add_to_queue':
          if (payload && payload.videoId) {
            const queueItem: QueueItem = {
              id: Date.now().toString(),
              videoId: payload.videoId,
              title: payload.title || 'Unknown Video',
              addedBy: socket.id,
              addedAt: new Date()
            };
            room.queue.push(queueItem);
          }
          break;
        case 'remove_from_queue':
          if (payload && payload.itemId) {
            room.queue = room.queue.filter(item => item.id !== payload.itemId);
          }
          break;
        case 'clear_queue':
          room.queue = [];
          break;
      }

      // Broadcast updated queue to all clients in the room
      io.to(roomId).emit('queue_update', room.queue);
      console.log(`Queue command processed: ${action} in room ${roomId}`);
    });

    // Disconnect event
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${socket.id}`);
      
      // Remove user from all rooms they were in
      rooms.forEach((room, roomId) => {
        room.connectedUsers = room.connectedUsers.filter(id => id !== socket.id);
        
        // If room is empty, clean it up
        if (room.connectedUsers.length === 0) {
          rooms.delete(roomId);
          console.log(`Room ${roomId} cleaned up (no users left)`);
        }
      });
    });
  });

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`);
    console.log(`> Socket.IO server initialized`);
  });
});
