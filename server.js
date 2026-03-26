const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, '.')));

// Rooms: { roomId: { players: [socket.id, socket.id], clocks: { white: 300, dark: 300 }, activeColor: 'white', interval: null } }
const rooms = {};
let matchQueue = [];

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function startTimer(roomId) {
  if (!rooms[roomId]) return;
  if (rooms[roomId].interval) return;
  rooms[roomId].interval = setInterval(() => {
    const room = rooms[roomId];
    if (!room || room.players.length < 2) return;

    room.clocks[room.activeColor]--;

    io.to(roomId).emit('timer_update', { clocks: room.clocks, activeColor: room.activeColor });

    if (room.clocks[room.activeColor] <= 0) {
      clearInterval(room.interval);
      io.to(roomId).emit('timeout', { winner: 'draw' });
    }
  }, 1000);
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on('quick_match', () => {
    // Remove if already in queue
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
    matchQueue.push(socket);

    if (matchQueue.length >= 2) {
      const p1 = matchQueue.shift();
      const p2 = matchQueue.shift();
      const roomId = generateRoomId();

      const isP1White = Math.random() > 0.5;
      const p1Color = isP1White ? 'white' : 'dark';
      const p2Color = isP1White ? 'dark' : 'white';

      rooms[roomId] = {
        players: [p1.id, p2.id],
        clocks: { white: 300, dark: 300 },
        activeColor: 'white',
        interval: null
      };

      p1.join(roomId);
      p2.join(roomId);

      p1.emit('match_found', { roomId, color: p1Color });
      p2.emit('match_found', { roomId, color: p2Color });

      startTimer(roomId);
    }
  });

  socket.on('cancel_match', () => {
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
  });

  socket.on('create_room', () => {
    const roomId = generateRoomId();
    rooms[roomId] = {
      players: [socket.id],
      clocks: { white: 300, dark: 300 },
      activeColor: 'white',
      interval: null
    };
    socket.join(roomId);
    socket.emit('room_created', { roomId, color: 'white' });
  });

  socket.on('join_room', ({ roomId }) => {
    const id = roomId.toUpperCase();
    const room = rooms[id];
    if (!room) return socket.emit('error', { message: 'Room not found.' });
    if (room.players.length >= 2) return socket.emit('error', { message: 'Room is full.' });

    room.players.push(socket.id);
    socket.join(id);
    socket.emit('room_joined', { roomId: id, color: 'dark' });
    io.to(room.players[0]).emit('opponent_joined');

    startTimer(id);
  });

  socket.on('sync_state', ({ roomId, state }) => {
    const room = rooms[roomId];
    if (room) {
      room.activeColor = state.currentPlayer;
      room.clocks = { white: 300, dark: 300 }; // Reset for each move
      socket.to(roomId).emit('receive_state', state);
    }
  });

  socket.on('disconnect', () => {
    matchQueue = matchQueue.filter(s => s.id !== socket.id);
    for (const [id, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        if (room.interval) clearInterval(room.interval);
        socket.to(id).emit('opponent_disconnected');
        delete rooms[id];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess 2 server running at http://localhost:${PORT}`);
});
