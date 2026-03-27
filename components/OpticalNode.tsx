'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera, Send, Terminal, Eye, Radio, ShieldCheck, ShieldAlert, Wrench, Shield, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

type ColorName = 'RED' | 'GREEN' | 'BLUE' | 'WHITE' | 'YELLOW' | 'BLACK' | 'UNKNOWN';

// Protocol Constants
const PROTOCOL = {
  START: 'WHITE',
  CLOCK: 'BLUE',
  BIT_0: 'RED',
  BIT_1: 'GREEN',
  END: 'YELLOW',
};

const classifyColor = (r: number, g: number, b: number): ColorName => {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const diff = max - min;

  if (r > 200 && g > 200 && b > 200) return 'WHITE';
  if (r < 80 && g < 80 && b < 80) return 'BLACK';
  if (r > 180 && g > 180 && b < 100) return 'YELLOW';

  if (diff > 50) {
    if (max === r && g < 150 && b < 150) return 'RED';
    if (max === g && r < 150 && b < 150) return 'GREEN';
    if (max === b && r < 150 && g < 150) return 'BLUE';
  }

  return 'UNKNOWN';
};

// Simple XOR Checksum for string
const calculateChecksum = (text: string): string => {
  let checksum = 0;
  for (let i = 0; i < text.length; i++) {
    checksum ^= text.charCodeAt(i);
  }
  return checksum.toString(2).padStart(8, '0');
};

// Hamming(7,4) FEC Encoder
const encodeHamming74 = (nibble: string): string => {
  const d1 = parseInt(nibble[0]);
  const d2 = parseInt(nibble[1]);
  const d3 = parseInt(nibble[2]);
  const d4 = parseInt(nibble[3]);

  const p1 = d1 ^ d2 ^ d4;
  const p2 = d1 ^ d3 ^ d4;
  const p3 = d2 ^ d3 ^ d4;

  return `${p1}${p2}${d1}${p3}${d2}${d3}${d4}`;
};

// Hamming(7,4) FEC Decoder
const decodeHamming74 = (block: string): { nibble: string, corrected: boolean } => {
  if (block.length !== 7) return { nibble: '0000', corrected: false };

  const bits = block.split('').map(Number);
  const p1 = bits[0], p2 = bits[1], d1 = bits[2];
  const p3 = bits[3], d2 = bits[4], d3 = bits[5], d4 = bits[6];

  const s1 = p1 ^ d1 ^ d2 ^ d4;
  const s2 = p2 ^ d1 ^ d3 ^ d4;
  const s3 = p3 ^ d2 ^ d3 ^ d4;

  const syndrome = s1 * 1 + s2 * 2 + s3 * 4;
  let corrected = false;

  if (syndrome !== 0 && syndrome <= 7) {
    corrected = true;
    bits[syndrome - 1] ^= 1; // Flip the corrupted bit
  }

  const decodedNibble = `${bits[2]}${bits[4]}${bits[5]}${bits[6]}`;
  return { nibble: decodedNibble, corrected };
};

const processPacketData = (binaryString: string) => {
  let decodedBits = '';
  let corrections = 0;

  for (let i = 0; i + 7 <= binaryString.length; i += 7) {
    const block = binaryString.slice(i, i + 7);
    const { nibble, corrected } = decodeHamming74(block);
    decodedBits += nibble;
    if (corrected) corrections++;
  }

  if (decodedBits.length < 16) return { text: '', valid: false, corrections };

  const payloadBits = decodedBits.slice(0, -8);
  const receivedChecksumBits = decodedBits.slice(-8);

  let text = '';
  for (let i = 0; i < payloadBits.length; i += 8) {
    const byte = payloadBits.slice(i, i + 8);
    if (byte.length === 8) {
      text += String.fromCharCode(parseInt(byte, 2));
    }
  }

  const calculatedChecksumBits = calculateChecksum(text);
  const valid = calculatedChecksumBits === receivedChecksumBits;
  return { text, valid, corrections };
};

interface SourceState {
  id: string;
  bits: string;
  waitingForData: boolean;
  lastColor: ColorName;
  isReceivingPacket: boolean;
  lastDecoded: string;
  corrections: number;
  lastUpdate: number;
}

export default function OpticalNode() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const [isReceiving, setIsReceiving] = useState(false);
  const [isTransmitting, setIsTransmitting] = useState(false);
  const [flashColor, setFlashColor] = useState<string>('#000000');
  const [logs, setLogs] = useState<{ id: number; timestamp: number; text: string; type: 'info' | 'success' | 'warning' | 'error' }[]>([]);
  const [messageToTransmit, setMessageToTransmit] = useState('SYNC');
  const [baudRate, setBaudRate] = useState<100 | 200 | 400>(200);
  const [lastVerifiedContract, setLastVerifiedContract] = useState<{text: string, valid: boolean, corrections: number} | null>(null);
  
  // Camera Selection
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [selectedCamera, setSelectedCamera] = useState<string>('');

  // UI panel toggles
  const [showTransmitter, setShowTransmitter] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  // Multi-source tracking state
  const sourcesRef = useRef<Map<string, SourceState>>(new Map());
  const logIdRef = useRef(0);

  const addLog = useCallback((text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    const id = ++logIdRef.current;
    setLogs(prev => [{ id, timestamp: Date.now(), text, type }, ...prev].slice(0, 20));
  }, []);

  // Enumerate Cameras
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const videoDevices = devices.filter(d => d.kind === 'videoinput');
      setCameras(videoDevices);
      if (videoDevices.length > 0 && !selectedCamera) {
        // Prefer back camera if available
        const backCamera = videoDevices.find(d => d.label.toLowerCase().includes('back') || d.label.toLowerCase().includes('environment'));
        setSelectedCamera(backCamera ? backCamera.deviceId : videoDevices[0].deviceId);
      }
    }).catch(err => console.error("Error enumerating devices:", err));
  }, []);

  // Camera Setup
  useEffect(() => {
    if (isReceiving) {
      const constraints: MediaStreamConstraints = {
        video: selectedCamera 
          ? { deviceId: { exact: selectedCamera }, frameRate: { ideal: 60 } } 
          : { facingMode: 'environment', frameRate: { ideal: 60 } }
      };

      navigator.mediaDevices.getUserMedia(constraints)
        .then(stream => {
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
            addLog('Optical sensor activated (Multi-source tracking)', 'success');
          }
        })
        .catch(err => {
          console.error(err);
          addLog('Failed to access optical sensor', 'error');
          setIsReceiving(false);
        });
    } else {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
        videoRef.current.srcObject = null;
        addLog('Optical sensor deactivated', 'info');
      }
      // Clear overlay
      if (overlayCanvasRef.current) {
        const octx = overlayCanvasRef.current.getContext('2d');
        if (octx) octx.clearRect(0, 0, overlayCanvasRef.current.width, overlayCanvasRef.current.height);
      }
    }
    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        const tracks = (videoRef.current.srcObject as MediaStream).getTracks();
        tracks.forEach(track => track.stop());
      }
    };
  }, [isReceiving, selectedCamera, addLog]);

  // Detection Loop (Grid-based Multi-Tracker)
  useEffect(() => {
    let animationFrameId: number;
    let lastTime = 0;

    const processFrame = (time: number) => {
      if (time - lastTime < 16) { 
        animationFrameId = requestAnimationFrame(processFrame);
        return;
      }
      lastTime = time;

      if (videoRef.current && canvasRef.current && overlayCanvasRef.current && isReceiving) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        const overlay = overlayCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const octx = overlay.getContext('2d');

        if (ctx && octx && video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          overlay.width = video.videoWidth;
          overlay.height = video.videoHeight;
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          octx.clearRect(0, 0, overlay.width, overlay.height);

          // 6x6 Grid for tracking multiple sources
          const GRID_X = 6;
          const GRID_Y = 6;
          const cellW = canvas.width / GRID_X;
          const cellH = canvas.height / GRID_Y;

          for (let y = 0; y < GRID_Y; y++) {
            for (let x = 0; x < GRID_X; x++) {
              const id = `N${x}${y}`;
              let source = sourcesRef.current.get(id);
              if (!source) {
                source = { id, bits: '', waitingForData: false, lastColor: 'UNKNOWN', isReceivingPacket: false, lastDecoded: '', corrections: 0, lastUpdate: 0 };
                sourcesRef.current.set(id, source);
              }

              // Sample center of the cell
              const sampleW = Math.min(20, cellW);
              const sampleH = Math.min(20, cellH);
              const cx = x * cellW + cellW / 2 - sampleW / 2;
              const cy = y * cellH + cellH / 2 - sampleH / 2;
              
              const imgData = ctx.getImageData(cx, cy, sampleW, sampleH).data;
              let r = 0, g = 0, b = 0;
              for (let i = 0; i < imgData.length; i += 4) {
                r += imgData[i];
                g += imgData[i+1];
                b += imgData[i+2];
              }
              const count = imgData.length / 4;
              const color = classifyColor(Math.round(r/count), Math.round(g/count), Math.round(b/count));
              
              // State Machine for this specific cell
              if (color !== source.lastColor) {
                source.lastColor = color;
                
                if (color === PROTOCOL.START) {
                  source.bits = '';
                  source.waitingForData = false;
                  source.isReceivingPacket = true;
                  source.lastUpdate = Date.now();
                } else if (source.isReceivingPacket) {
                  if (color === PROTOCOL.CLOCK) {
                    source.waitingForData = true;
                    source.lastUpdate = Date.now();
                  } else if (color === PROTOCOL.BIT_0 && source.waitingForData) {
                    source.bits += '0';
                    source.waitingForData = false;
                    source.lastUpdate = Date.now();
                  } else if (color === PROTOCOL.BIT_1 && source.waitingForData) {
                    source.bits += '1';
                    source.waitingForData = false;
                    source.lastUpdate = Date.now();
                  } else if (color === PROTOCOL.END) {
                    source.isReceivingPacket = false;
                    source.waitingForData = false;
                    if (source.bits.length > 0) {
                      const result = processPacketData(source.bits);
                      source.lastDecoded = result.text;
                      source.corrections = result.corrections;
                      source.lastUpdate = Date.now();
                      
                      setLastVerifiedContract(result);
                      if (result.valid) {
                        addLog(`[${id}] Validated: ${result.text}`, 'success');
                      } else {
                        addLog(`[${id}] Corrupted: ${result.text}`, 'error');
                      }
                    }
                  }
                }
              }

              // Draw Bounding Boxes on Overlay
              const timeSinceUpdate = Date.now() - source.lastUpdate;
              if (source.isReceivingPacket || (timeSinceUpdate < 4000 && source.lastDecoded)) {
                const boxX = x * cellW;
                const boxY = y * cellH;
                
                octx.strokeStyle = source.isReceivingPacket ? '#10b981' : '#3b82f6'; // Green if receiving, Blue if done
                octx.lineWidth = 3;
                octx.strokeRect(boxX, boxY, cellW, cellH);
                
                // Label background
                octx.fillStyle = 'rgba(0, 0, 0, 0.7)';
                octx.fillRect(boxX, boxY, cellW, 24);
                
                // Label text
                octx.fillStyle = '#ffffff';
                octx.font = '12px monospace';
                const statusText = source.isReceivingPacket ? 'SYNCING...' : source.lastDecoded;
                octx.fillText(`${id}: ${statusText}`, boxX + 4, boxY + 16);
              }
            }
          }
        }
      }
      animationFrameId = requestAnimationFrame(processFrame);
    };

    if (isReceiving) {
      animationFrameId = requestAnimationFrame(processFrame);
    }
    return () => cancelAnimationFrame(animationFrameId);
  }, [isReceiving, addLog]);

  const transmitData = async () => {
    if (!messageToTransmit || isTransmitting) return;
    
    setIsTransmitting(true);
    addLog(`Initiating LBP Broadcast with FEC...`, 'warning');
    
    let binaryPayload = '';
    for (let i = 0; i < messageToTransmit.length; i++) {
      binaryPayload += messageToTransmit.charCodeAt(i).toString(2).padStart(8, '0');
    }

    const checksumBits = calculateChecksum(messageToTransmit);
    const fullData = binaryPayload + checksumBits;
    
    let fecTransmission = '';
    for (let i = 0; i < fullData.length; i += 4) {
      fecTransmission += encodeHamming74(fullData.slice(i, i + 4));
    }
    
    addLog(`Raw: ${fullData.length} bits | FEC Encoded: ${fecTransmission.length} bits`, 'info');

    const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    setFlashColor('#FFFFFF'); // WHITE
    await wait(baudRate * 3);

    for (let i = 0; i < fecTransmission.length; i++) {
      setFlashColor('#0000FF'); // BLUE
      await wait(baudRate);

      const bit = fecTransmission[i];
      setFlashColor(bit === '1' ? '#00FF00' : '#FF0000'); // GREEN or RED
      await wait(baudRate);
    }

    setFlashColor('#FFFF00'); // YELLOW
    await wait(baudRate * 3);

    setFlashColor('#000000'); // BLACK
    setIsTransmitting(false);
    addLog(`Broadcast complete.`, 'success');
  };

  return (
    <div className="relative h-full w-full overflow-hidden">

      {/* ===== FULLSCREEN VIDEO BACKGROUND ===== */}
      {isReceiving && (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="absolute inset-0 w-full h-full object-cover"
          />
          <canvas ref={canvasRef} className="hidden" />
          <canvas
            ref={overlayCanvasRef}
            className="absolute inset-0 w-full h-full object-cover pointer-events-none z-[5]"
          />
          {/* Subtle scan grid */}
          <div className="absolute inset-0 pointer-events-none z-[6] opacity-15">
            <div className="w-full h-full grid grid-cols-6 grid-rows-6">
              {Array.from({ length: 36 }).map((_, i) => (
                <div key={i} className="border border-emerald-500/30" />
              ))}
            </div>
          </div>
          {/* Vignette */}
          <div
            className="absolute inset-0 pointer-events-none z-[7]"
            style={{
              background:
                'radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,0.7) 100%)',
            }}
          />
        </>
      )}

      {/* ===== FULLSCREEN TRANSMIT FLASH ===== */}
      {isTransmitting && (
        <div
          className="absolute inset-0 z-[50] flex items-center justify-center"
          style={{
            backgroundColor: flashColor,
            transition: `background-color ${baudRate * 0.2}ms ease`,
          }}
        >
          <span className="text-5xl font-bold tracking-[0.3em] mix-blend-difference text-white select-none">
            TRANSMITTING
          </span>
        </div>
      )}

      {/* ===== IDLE / ONBOARDING SCREEN ===== */}
      {!isReceiving && !isTransmitting && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-8">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center gap-8 max-w-sm text-center"
          >
            <div className="relative">
              <div className="w-24 h-24 rounded-full border-2 border-emerald-500/20 flex items-center justify-center">
                <Camera className="w-12 h-12 text-emerald-500/40" />
              </div>
              <div
                className="absolute -inset-4 rounded-full border border-emerald-500/10 animate-ping"
                style={{ animationDuration: '3s' }}
              />
            </div>

            <div>
              <h2 className="text-xl font-bold text-emerald-400 tracking-[0.2em] mb-3">
                OPTICAL RECEIVER
              </h2>
              <p className="text-sm text-emerald-700 leading-relaxed">
                Point your camera at a screen broadcasting via the Lumina
                Light-Based Protocol. The sensor will detect and decode color
                transmissions in real time.
              </p>
            </div>

            {cameras.length > 1 && (
              <select
                value={selectedCamera}
                onChange={(e) => setSelectedCamera(e.target.value)}
                className="bg-black/50 border border-emerald-500/20 text-xs text-emerald-600 rounded-lg px-4 py-2 outline-none backdrop-blur-sm"
              >
                {cameras.map((c) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera ${c.deviceId.slice(0, 5)}`}
                  </option>
                ))}
              </select>
            )}

            <button
              onClick={() => setIsReceiving(true)}
              className="px-10 py-4 bg-emerald-500/10 border-2 border-emerald-500/40 text-emerald-400 font-bold text-base tracking-[0.15em] rounded-2xl hover:bg-emerald-500/20 hover:border-emerald-500/60 transition-all active:scale-95"
            >
              <Eye className="w-5 h-5 inline mr-3 -mt-0.5" />
              ACTIVATE SENSOR
            </button>
          </motion.div>
        </div>
      )}

      {/* ===== TOP BAR (glass) ===== */}
      <div className="absolute top-0 left-0 right-0 z-40 p-3">
        <div className="flex items-center justify-between backdrop-blur-2xl bg-black/50 border border-white/[0.08] rounded-2xl px-4 py-2.5 shadow-2xl">
          <div className="flex items-center gap-2.5">
            <Shield className="w-5 h-5 text-emerald-400" />
            <div>
              <h1 className="text-xs font-bold tracking-[0.15em] text-emerald-400">
                LUMINA PROTOCOL
              </h1>
              <p className="text-[9px] text-emerald-700 tracking-wider">
                NODE v1.0.4
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            {isReceiving && (
              <>
                <div className="flex items-center gap-1.5 text-[10px] text-emerald-500 tracking-wider">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="animate-ping absolute h-full w-full rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  SCANNING
                </div>
                {cameras.length > 1 && (
                  <select
                    value={selectedCamera}
                    onChange={(e) => {
                      setSelectedCamera(e.target.value);
                    }}
                    className="bg-white/5 border border-white/10 text-[10px] text-zinc-400 rounded-lg px-2 py-1 outline-none max-w-[100px] truncate"
                  >
                    {cameras.map((c) => (
                      <option key={c.deviceId} value={c.deviceId}>
                        {c.label || `Cam ${c.deviceId.slice(0, 5)}`}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  onClick={() => setIsReceiving(false)}
                  className="px-3 py-1 text-[10px] font-bold tracking-wider bg-red-500/10 text-red-400 border border-red-500/30 rounded-full hover:bg-red-500/20 transition-colors"
                >
                  STOP
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ===== VERIFIED CONTRACT FLOATING CARD ===== */}
      <AnimatePresence>
        {lastVerifiedContract && isReceiving && (
          <motion.div
            initial={{ opacity: 0, y: -10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="absolute top-20 right-3 z-40 w-64"
          >
            <div
              className={`backdrop-blur-2xl border rounded-2xl p-3.5 shadow-2xl ${
                lastVerifiedContract.valid
                  ? 'bg-emerald-950/60 border-emerald-500/30'
                  : 'bg-red-950/60 border-red-500/30'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  {lastVerifiedContract.valid ? (
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  ) : (
                    <ShieldAlert className="w-4 h-4 text-red-400" />
                  )}
                  <span
                    className={`text-[10px] font-bold tracking-wider ${
                      lastVerifiedContract.valid
                        ? 'text-emerald-400'
                        : 'text-red-400'
                    }`}
                  >
                    {lastVerifiedContract.valid ? 'VALIDATED' : 'CORRUPTED'}
                  </span>
                </div>
                {lastVerifiedContract.corrections > 0 && (
                  <div className="flex items-center gap-1 text-[9px] text-yellow-400 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">
                    <Wrench className="w-2.5 h-2.5" />
                    {lastVerifiedContract.corrections} fixed
                  </div>
                )}
              </div>
              <div className="font-mono text-white text-sm break-all bg-black/30 rounded-lg px-2.5 py-2">
                {lastVerifiedContract.text}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ===== BOTTOM PANELS ===== */}
      <div className="absolute bottom-0 left-0 right-0 z-40 p-3 space-y-2.5">
        {/* Expandable Log Panel */}
        <AnimatePresence>
          {showLogs && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="backdrop-blur-2xl bg-black/60 border border-white/[0.08] rounded-2xl p-4 max-h-48 overflow-y-auto shadow-2xl">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider text-zinc-400">
                    <Terminal className="w-3.5 h-3.5" />
                    SYSTEM LOG
                  </div>
                  <button
                    onClick={() => setShowLogs(false)}
                    className="text-zinc-500 hover:text-zinc-300"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5 font-mono text-[10px]">
                  <AnimatePresence>
                    {logs.map((log) => (
                      <motion.div
                        key={log.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex gap-2 ${
                          log.type === 'error'
                            ? 'text-red-400'
                            : log.type === 'success'
                              ? 'text-emerald-400'
                              : log.type === 'warning'
                                ? 'text-yellow-400'
                                : 'text-zinc-500'
                        }`}
                      >
                        <span className="opacity-40 shrink-0">
                          [{new Date(log.timestamp).toLocaleTimeString()}]
                        </span>
                        <span className="break-all">{log.text}</span>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Expandable Transmitter Panel */}
        <AnimatePresence>
          {showTransmitter && !isTransmitting && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="backdrop-blur-2xl bg-black/60 border border-white/[0.08] rounded-2xl p-4 space-y-3 shadow-2xl">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[10px] font-bold tracking-wider text-zinc-400">
                    <Radio className="w-3.5 h-3.5" />
                    BROADCAST EMITTER
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={baudRate}
                      onChange={(e) =>
                        setBaudRate(Number(e.target.value) as 100 | 200 | 400)
                      }
                      className="bg-white/5 border border-white/10 text-[10px] text-zinc-400 rounded-lg px-2 py-1 outline-none"
                    >
                      <option value={400}>Slow</option>
                      <option value={200}>Standard</option>
                      <option value={100}>Fast</option>
                    </select>
                    <button
                      onClick={() => setShowTransmitter(false)}
                      className="text-zinc-500 hover:text-zinc-300"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <div className="flex gap-2.5">
                  <input
                    type="text"
                    value={messageToTransmit}
                    onChange={(e) => setMessageToTransmit(e.target.value)}
                    disabled={isTransmitting}
                    className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-emerald-400 font-mono text-sm focus:outline-none focus:border-emerald-500/30 disabled:opacity-50 min-w-0"
                    placeholder="Enter payload..."
                    maxLength={16}
                  />
                  <button
                    onClick={transmitData}
                    disabled={isTransmitting || !messageToTransmit}
                    className="bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-30 flex items-center gap-2 border border-emerald-500/30 shrink-0"
                  >
                    <Send className="w-4 h-4" />
                    <span className="text-xs tracking-wider">BROADCAST</span>
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Bottom Action Bar */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowLogs(!showLogs)}
            className={`flex-1 backdrop-blur-2xl border rounded-2xl px-4 py-3 text-[10px] font-bold tracking-wider transition-colors flex items-center justify-center gap-2 ${
              showLogs
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-black/50 border-white/[0.08] text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            LOG
          </button>

          <button
            onClick={() => setShowTransmitter(!showTransmitter)}
            className={`flex-1 backdrop-blur-2xl border rounded-2xl px-4 py-3 text-[10px] font-bold tracking-wider transition-colors flex items-center justify-center gap-2 ${
              showTransmitter
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                : 'bg-black/50 border-white/[0.08] text-zinc-500 hover:text-zinc-300'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            TRANSMIT
          </button>

          {!isReceiving && (
            <button
              onClick={() => setIsReceiving(true)}
              className="flex-1 backdrop-blur-2xl bg-emerald-500/10 border border-emerald-500/30 rounded-2xl px-4 py-3 text-[10px] font-bold tracking-wider text-emerald-400 transition-colors flex items-center justify-center gap-2 hover:bg-emerald-500/20"
            >
              <Eye className="w-3.5 h-3.5" />
              RECEIVE
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
