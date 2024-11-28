'use client'

import { useEffect, useRef, useState } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { io, Socket } from 'socket.io-client'

export default function VideoChat() {
  const [isSearching, setIsSearching] = useState(false)
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [isSkipping, setIsSkipping] = useState(false)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const socketRef = useRef<Socket>()
  const peerConnectionRef = useRef<RTCPeerConnection>()
  const roomRef = useRef<string>('')
  const [hasStartedVideo, setHasStartedVideo] = useState(false)

  const initializePeerConnection = () => {
    const configuration = { 
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] 
    }
    
    // Close existing connection if any
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
    }
    
    // Create new peer connection
    peerConnectionRef.current = new RTCPeerConnection(configuration);

    // Re-add local tracks to the new peer connection
    if (localVideoRef.current?.srcObject instanceof MediaStream) {
      localVideoRef.current.srcObject.getTracks().forEach(track => {
        if (localVideoRef.current?.srcObject instanceof MediaStream) {
          peerConnectionRef.current?.addTrack(track, localVideoRef.current.srcObject);
        }
      });
    }

    // Set up event handlers for the new peer connection
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = (event) => {
        if (event.candidate) {
          socketRef.current?.emit('ice-candidate', {
            candidate: event.candidate,
            room: roomRef.current
          });
        }
      };

      peerConnectionRef.current.ontrack = (event) => {
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = event.streams[0];
        }
      };
    }
  };

  useEffect(() => {
    // Initialize socket connection
    const SOCKET_URL = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:3001';
    socketRef.current = io(SOCKET_URL);
    initializePeerConnection();

    return () => {
      socketRef.current?.disconnect();
      if (peerConnectionRef.current) {
        peerConnectionRef.current.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!socketRef.current) return;

    const handleOffer = async (offer: RTCSessionDescriptionInit) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(offer));
        const answer = await peerConnectionRef.current.createAnswer();
        await peerConnectionRef.current.setLocalDescription(answer);
        socketRef.current?.emit('answer', { answer, room: roomRef.current });
      } catch (error) {
        console.error('Error handling offer:', error);
      }
    };

    const handleAnswer = async (answer: RTCSessionDescriptionInit) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (error) {
        console.error('Error handling answer:', error);
      }
    };

    const handleIceCandidate = async (candidate: RTCIceCandidateInit) => {
      if (!peerConnectionRef.current) return;
      try {
        await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Error handling ICE candidate:', error);
      }
    };

    socketRef.current.on('offer', handleOffer);
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);

    return () => {
      socketRef.current?.off('offer', handleOffer);
      socketRef.current?.off('answer', handleAnswer);
      socketRef.current?.off('ice-candidate', handleIceCandidate);
    };
  }, []);

  const startVideo = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: true, 
        audio: true 
      })
      
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream
      }

      // Add tracks to peer connection
      stream.getTracks().forEach(track => {
        peerConnectionRef.current?.addTrack(track, stream)
      })

      setHasStartedVideo(true)
    } catch (error) {
      console.error('Error accessing media devices:', error)
    }
  }

  const connectToUser = () => {
    if (!socketRef.current || !hasStartedVideo) return;
    
    setIsConnecting(true);
    socketRef.current.emit('joinRoom');

    // Remove existing listeners
    socketRef.current.off('userConnected');
    socketRef.current.off('userDisconnected');
    
    // Handle user disconnection
    socketRef.current.on('userDisconnected', () => {
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = null;
      }
      setIsConnected(false);
    });
    
    socketRef.current.on('userConnected', async ({ room, isInitiator }) => {
      setIsConnected(true);
      setIsConnecting(false);
      setIsSkipping(false);
      roomRef.current = room;

      // Only create offer if we're the initiator
      if (isInitiator && peerConnectionRef.current) {
        try {
          const offer = await peerConnectionRef.current.createOffer();
          await peerConnectionRef.current.setLocalDescription(offer);
          socketRef.current?.emit('offer', { offer, room });
        } catch (error) {
          console.error('Error creating offer:', error);
        }
      }
    });
  }

  const skipToNextUser = async () => {
    setIsSkipping(true);
    
    // Clear remote video
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    // Initialize new peer connection
    initializePeerConnection();
    
    setIsConnected(false);
    
    // Start searching for new user
    connectToUser();
  };

  return (
    <div className="min-h-screen p-4 flex flex-col items-center gap-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-4xl">
        <Card className="p-4 relative">
          <video
            ref={localVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full rounded-lg bg-black"
          />
          <p className="text-center mt-2">You</p>
        </Card>
        
        <Card className="p-4 relative">
          <video
            ref={remoteVideoRef}
            autoPlay
            playsInline
            className="w-full rounded-lg bg-black"
          />
          {(isSearching || isConnecting || isSkipping) && (
            <div className="absolute inset-0 bg-black/50 rounded-lg flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 text-white">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
                <p className="text-sm">
                  {isSkipping ? 'Finding next person...' : 
                   isSearching ? 'Searching for someone...' : 
                   'Connecting...'}
                </p>
              </div>
            </div>
          )}
          <p className="text-center mt-2">Stranger</p>
        </Card>
      </div>

      <div className="flex gap-4 flex-wrap justify-center">
        <Button 
          onClick={startVideo}
          disabled={hasStartedVideo}
          className="min-w-[140px]"
        >
          {hasStartedVideo ? 'Camera Started' : 'Start Camera'}
        </Button>
        
        {!isConnected ? (
          <Button 
            onClick={connectToUser}
            disabled={isConnecting || isConnected || !hasStartedVideo || isSkipping}
            className="min-w-[140px]"
          >
            {isConnecting ? 'Connecting...' : 
             isSkipping ? 'Finding Next...' : 
             'Find Someone'}
          </Button>
        ) : (
          <Button 
            onClick={skipToNextUser}
            disabled={!isConnected || isSkipping}
            variant="secondary"
            className="min-w-[140px]"
          >
            Next Person
          </Button>
        )}
      </div>

      {/* Connection status indicator */}
      <div className="text-sm text-muted-foreground flex items-center gap-2">
        <div 
          className={`w-2 h-2 rounded-full ${
            isConnected ? 'bg-green-500' : 
            isSearching || isConnecting ? 'bg-yellow-500' : 
            'bg-red-500'
          }`}
        />
        {isConnected ? 'Connected' : 
         isSearching ? 'Searching...' : 
         isConnecting ? 'Connecting...' : 
         'Not Connected'}
      </div>
    </div>
  )
} 