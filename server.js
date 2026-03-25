const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// Rooms: { roomId: { players: [socket.id, socket.id], state: gameState } }
const rooms = {};

function generateRoomId() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Create a new room
  socket.on('create_room', () => {
    const roomId = generateRoomId();
    rooms[roomId] = { players: [socket.id], state: null };
    socket.join(roomId);
    socket.emit('room_created', { roomId, color: 'white' });
    console.log(`Room created: ${roomId}`);
  });

  // Join existing room
  socket.on('join_room', ({ roomId }) => {
    const room = rooms[roomId.toUpperCase()];
    if (!room) {
      socket.emit('error', { message: 'Room not found.' });
      return;
    }
    if (room.players.length >= 2) {
      socket.emit('error', { message: 'Room is full.' });
      return;
    }
    room.players.push(socket.id);
    socket.join(roomId.toUpperCase());
    socket.emit('room_joined', { roomId: roomId.toUpperCase(), color: 'dark' });
    // Notify the first player that the opponent joined
    io.to(room.players[0]).emit('opponent_joined');
    console.log(`Player joined room: ${roomId.toUpperCase()}`);
  });

  // Relay a move to the opponent
  socket.on('send_move', ({ roomId, moveData }) => {
    socket.to(roomId).emit('receive_move', moveData);
  });

  // Relay game state sync
  socket.on('sync_state', ({ roomId, state }) => {
    socket.to(roomId).emit('receive_state', state);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    for (const [roomId, room] of Object.entries(rooms)) {
      if (room.players.includes(socket.id)) {
        socket.to(roomId).emit('opponent_disconnected');
        delete rooms[roomId];
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Chess 2 server running at http://localhost:${PORT}`);
});
