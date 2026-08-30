import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getFirestore, 
  collection, 
  addDoc, 
  onSnapshot, 
  query, 
  orderBy, 
  doc, 
  setDoc, 
  updateDoc, 
  deleteDoc,
  getDoc,
  serverTimestamp 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDS9A2CqtnY3-2vv9KmNDPUl5sXifxrmYM",
  authDomain: "sleek-chat-app-47b2a.firebaseapp.com",
  projectId: "sleek-chat-app-47b2a",
  storageBucket: "sleek-chat-app-47b2a.firebasestorage.app",
  messagingSenderId: "830967591682",
  appId: "1:830967591682:web:5d7038480abeadbd64081b"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// Unique session identifier for identifying message ownership
const userId = 'user_' + Math.random().toString(36).substring(2, 9);

// WebRTC Configuration with Echo Cancellation constraints
const servers = { 
  iceServers: [
    { urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }
  ] 
};
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let isAudioMuted = false;

// DOM Elements
const messagesContainer = document.getElementById("messagesContainer");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const voiceMsgBtn = document.getElementById("voiceMsgBtn");
const startCallBtn = document.getElementById("startCallBtn");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");
const endCallBtn = document.getElementById("endCallBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const mediaPlaceholder = document.getElementById("mediaPlaceholder");
const incomingCallModal = document.getElementById("incomingCallModal");

// --- Messaging System ---
const messagesRef = collection(db, "messages");
const messagesQuery = query(messagesRef, orderBy("timestamp", "asc"));

onSnapshot(messagesQuery, (snapshot) => {
  messagesContainer.innerHTML = "";
  snapshot.forEach((docSnap) => {
    const data = docSnap.data();
    const docId = docSnap.id;
    const isOwner = data.senderId === userId;

    const div = document.createElement("div");
    div.className = `message-bubble ${isOwner ? 'sent' : 'received'}`;
    
    let contentHtml = '';
    if (data.audioUrl) {
      contentHtml = `<audio controls src="${data.audioUrl}" style="max-width:200px;"></audio>`;
    } else {
      contentHtml = `<div class="message-content">${escapeHtml(data.text)}</div>`;
    }

    const timeString = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Just now';

    div.innerHTML = `
      ${contentHtml}
      <div class="msg-footer">
        <span class="msg-time">${timeString}</span>
        ${isOwner ? `<button class="delete-msg-btn" data-id="${docId}">Delete</button>` : ''}
      </div>
    `;

    messagesContainer.appendChild(div);
  });
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

// Delete message listener
messagesContainer.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-msg-btn")) {
    const docId = e.target.getAttribute("data-id");
    try {
      await deleteDoc(doc(db, "messages", docId));
    } catch (err) {
      console.error("Error deleting message:", err);
    }
  }
});

async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  await addDoc(messagesRef, {
    text: text,
    senderId: userId,
    timestamp: serverTimestamp()
  });
  messageInput.value = "";
}

sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => {
  if (e.key === "Enter") sendMessage();
});

// --- Voice Messaging ---
let mediaRecorder;
let audioChunks = [];

voiceMsgBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        const storageRef = ref(storage, `voice/${Date.now()}.webm`);
        await uploadBytes(storageRef, audioBlob);
        const url = await getDownloadURL(storageRef);
        await addDoc(messagesRef, {
          audioUrl: url,
          senderId: userId,
          timestamp: serverTimestamp()
        });
      };
      mediaRecorder.start();
      voiceMsgBtn.style.background = "rgba(244, 63, 94, 0.2)";
    } catch (err) {
      alert("Microphone permission denied.");
    }
  } else {
    mediaRecorder.stop();
    voiceMsgBtn.style.background = "";
  }
});

// --- WebRTC Multi-Device Calling System ---
const callsRef = collection(db, "calls");
const callDocId = "globalActiveCallSession";

async function getMediaStream(videoEnabled = false) {
  return await navigator.mediaDevices.getUserMedia({ 
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }, 
    video: videoEnabled 
  });
}

function setupPeerConnection() {
  peerConnection = new RTCPeerConnection(servers);
  remoteStream = new MediaStream();
  remoteVideo.srcObject = remoteStream;

  peerConnection.ontrack = (event) => {
    event.streams[0].getTracks().forEach(track => remoteStream.addTrack(track));
    mediaPlaceholder.style.display = "none";
  };
}

// 1. Caller starts the session
startCallBtn.addEventListener("click", async () => {
  try {
    localStream = await getMediaStream(false);
    localVideo.srcObject = localStream;
    mediaPlaceholder.style.display = "none";

    setupPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const callDoc = doc(callsRef, callDocId);
    const offerCandidates = collection(callDoc, "offerCandidates");
    const answerCandidates = collection(callDoc, "answerCandidates");

    peerConnection.onicecandidate = e => e.candidate && addDoc(offerCandidates, e.candidate.toJSON());

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await setDoc(callDoc, { offer: { type: offer.type, sdp: offer.sdp }, status: "calling" });

    onSnapshot(callDoc, async (snapshot) => {
      const data = snapshot.data();
      if (peerConnection && !peerConnection.currentRemoteDescription && data?.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    onSnapshot(answerCandidates, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });

    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    toggleCameraBtn.disabled = false;
    toggleMicBtn.disabled = false;
  } catch (err) {
    console.error("Call initialization failed:", err);
    alert("Could not access microphone.");
  }
});

// 2. Global listener detecting incoming calls
onSnapshot(doc(callsRef, callDocId), (snapshot) => {
  const data = snapshot.data();
  if (data?.offer && !peerConnection && data?.status === "calling") {
    incomingCallModal.classList.remove("hidden");
  }
});

// 3. Callee accepts the call popup
acceptCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  try {
    localStream = await getMediaStream(false);
    localVideo.srcObject = localStream;
    mediaPlaceholder.style.display = "none";

    setupPeerConnection();
    localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));

    const callDoc = doc(callsRef, callDocId);
    const answerCandidates = collection(callDoc, "answerCandidates");
    const offerCandidates = collection(callDoc, "offerCandidates");

    peerConnection.onicecandidate = e => e.candidate && addDoc(answerCandidates, e.candidate.toJSON());

    const callSnap = await getDoc(callDoc);
    const callData = callSnap.data();

    await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await updateDoc(callDoc, { answer: { type: answer.type, sdp: answer.sdp }, status: "connected" });

    onSnapshot(offerCandidates, (snapshot) => {
      snapshot.docChanges().forEach(change => {
        if (change.type === "added") {
          peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });

    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    toggleCameraBtn.disabled = false;
    toggleMicBtn.disabled = false;
  } catch (err) {
    console.error("Error accepting call:", err);
  }
});

rejectCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  try {
    await updateDoc(doc(callsRef, callDocId), { offer: null, status: "rejected" });
  } catch(e) {}
});

// Toggle Video Camera on the fly
toggleCameraBtn.addEventListener("click", async () => {
  let videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoTrack = camStream.getVideoTracks()[0];
      localStream.addTrack(videoTrack);
      
      const sender = peerConnection.getSenders().find(s => s.track && s.track.kind === 'video');
      if (sender) {
        sender.replaceTrack(videoTrack);
      } else {
        peerConnection.addTrack(videoTrack, localStream);
      }
      localVideo.srcObject = localStream;
      toggleCameraBtn.style.background = "var(--accent)";
    } catch (e) {
      alert("Camera permission denied or unavailable.");
    }
  } else {
    videoTrack.enabled = !videoTrack.enabled;
    toggleCameraBtn.style.background = videoTrack.enabled ? "var(--accent)" : "";
  }
});

// Toggle Microphone Mute
toggleMicBtn.addEventListener("click", () => {
  const audioTrack = localStream.getAudioTracks()[0];
  if (audioTrack) {
    isAudioMuted = !isAudioMuted;
    audioTrack.enabled = !isAudioMuted;
    toggleMicBtn.style.background = isAudioMuted ? "var(--danger)" : "";
    toggleMicBtn.innerHTML = isAudioMuted ? '<span class="icon">🔇</span> Unmute' : '<span class="icon">🎙️</span> Mute';
  }
});

// Hang up call
endCallBtn.addEventListener("click", () => {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  location.reload();
});

// Utility security helper
function escapeHtml(text) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return text.replace(/[&<>"']/g, m => map[m]);
}