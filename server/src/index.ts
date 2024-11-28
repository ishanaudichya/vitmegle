import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// Store for users waiting to be matched
const waitingUsers = new Set<string>();

// Add at the top with other state
const userRooms = new Map<string, string>();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('joinRoom', () => {
    // Remove user from previous room if any
    const previousRoom = userRooms.get(socket.id);
    if (previousRoom) {
      socket.leave(previousRoom);
      socket.to(previousRoom).emit('userDisconnected');
      userRooms.delete(socket.id);
    }

    if (waitingUsers.size > 0) {
      const [partnerId] = waitingUsers;
      waitingUsers.delete(partnerId);
      
      const room = `room_${partnerId}_${socket.id}`;
      
      socket.join(room);
      io.sockets.sockets.get(partnerId)?.join(room);
      
      // Store room information
      userRooms.set(socket.id, room);
      userRooms.set(partnerId, room);

      io.to(partnerId).emit('userConnected', { room, isInitiator: false });
      io.to(socket.id).emit('userConnected', { room, isInitiator: true });
    } else {
      waitingUsers.add(socket.id);
    }
  });

  // Handle WebRTC signaling
  socket.on('offer', ({ offer, room }) => {
    socket.to(room).emit('offer', offer);
  });

  socket.on('answer', ({ answer, room }) => {
    socket.to(room).emit('answer', answer);
  });

  socket.on('ice-candidate', ({ candidate, room }) => {
    socket.to(room).emit('ice-candidate', candidate);
  });

  socket.on('disconnect', () => {
    // Notify room partner when user disconnects
    const room = userRooms.get(socket.id);
    if (room) {
      socket.to(room).emit('userDisconnected');
      userRooms.delete(socket.id);
    }
    waitingUsers.delete(socket.id);
    console.log('User disconnected:', socket.id);
  });
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
