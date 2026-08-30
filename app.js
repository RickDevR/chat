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
  getDoc 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);

// WebRTC Configuration
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };
let peerConnection = null;
let localStream = null;
let remoteStream = null;

// DOM Elements
const messagesContainer = document.getElementById("messagesContainer");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const voiceMsgBtn = document.getElementById("voiceMsgBtn");
const startCallBtn = document.getElementById("startCallBtn");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const endCallBtn = document.getElementById("endCallBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const incomingCallModal = document.getElementById("incomingCallModal");

// --- Text Messaging ---
const messagesRef = collection(db, "messages");
const q = query(messagesRef, orderBy("timestamp", "asc"));

onSnapshot(q, (snapshot) => {
  messagesContainer.innerHTML = "";
  snapshot.forEach((doc) => {
    const data = doc.data();
    const div = document.createElement("div");
    div.className = `message ${data.type === 'sent' ? 'sent' : 'received'}`;
    
    if (data.audioUrl) {
      div.innerHTML = `<audio controls src="${data.audioUrl}"></audio>`;
    } else {
      div.textContent = data.text;
    }
    messagesContainer.appendChild(div);
  });
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
});

sendBtn.addEventListener("click", async () => {
  if (!messageInput.value.trim()) return;
  await addDoc(messagesRef, { text: messageInput.value, timestamp: new Date(), type: 'sent' });
  messageInput.value = "";
});

// --- Voice Messages ---
let mediaRecorder;
let audioChunks = [];

voiceMsgBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];
    mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      const storageRef = ref(storage, `voice/${Date.now()}.webm`);
      await uploadBytes(storageRef, audioBlob);
      const url = await getDownloadURL(storageRef);
      await addDoc(messagesRef, { audioUrl: url, timestamp: new Date(), type: 'sent' });
    };
    mediaRecorder.start();
    voiceMsgBtn.style.background = "#ef4444";
  } else {
    mediaRecorder.stop();
    voiceMsgBtn.style.background = "";
  }
});

// --- Calling (WebRTC + Firestore Signaling) ---
const callsRef = collection(db, "calls");
let callDocId = "activeCallDoc";

startCallBtn.addEventListener("click", async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  remoteStream = new MediaStream();

  peerConnection = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = e => e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  remoteVideo.srcObject = remoteStream;

  const callDoc = doc(callsRef, callDocId);
  const offerCandidates = collection(callDoc, "offerCandidates");
  const answerCandidates = collection(callDoc, "answerCandidates");

  peerConnection.onicecandidate = e => e.candidate && addDoc(offerCandidates, e.candidate.toJSON());

  const offer = await peerConnection.createOffer();
  await peerConnection.setLocalDescription(offer);
  await setDoc(callDoc, { offer: { type: offer.type, sdp: offer.sdp } });

  onSnapshot(callDoc, (snapshot) => {
    const data = snapshot.data();
    if (peerConnection && !peerConnection.currentRemoteDescription && data?.answer) {
      peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
  });

  onSnapshot(answerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
    });
  });

  startCallBtn.disabled = true;
  endCallBtn.disabled = false;
  toggleCameraBtn.disabled = false;
});

// Listener for Incoming Calls
onSnapshot(doc(callsRef, callDocId), (snapshot) => {
  const data = snapshot.data();
  if (data?.offer && !peerConnection) {
    incomingCallModal.classList.remove("hidden");
  }
});

acceptCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  remoteStream = new MediaStream();

  peerConnection = new RTCPeerConnection(servers);
  localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
  peerConnection.ontrack = e => e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));
  remoteVideo.srcObject = remoteStream;

  const callDoc = doc(callsRef, callDocId);
  const answerCandidates = collection(callDoc, "answerCandidates");
  const offerCandidates = collection(callDoc, "offerCandidates");

  peerConnection.onicecandidate = e => e.candidate && addDoc(answerCandidates, e.candidate.toJSON());

  const callSnap = await getDoc(callDoc);
  const callData = callSnap.data();
  await peerConnection.setRemoteDescription(new RTCSessionDescription(callData.offer));

  const answer = await peerConnection.createAnswer();
  await peerConnection.setLocalDescription(answer);
  await updateDoc(callDoc, { answer: { type: answer.type, sdp: answer.sdp } });

  onSnapshot(offerCandidates, (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
    });
  });

  startCallBtn.disabled = true;
  endCallBtn.disabled = false;
  toggleCameraBtn.disabled = false;
});

toggleCameraBtn.addEventListener("click", async () => {
  const videoTrack = localStream.getVideoTracks()[0];
  if (!videoTrack) {
    const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
    const track = camStream.getVideoTracks()[0];
    localStream.addTrack(track);
    peerConnection.getSenders().find(s => s.track?.kind === 'video')?.replaceTrack(track) || peerConnection.addTrack(track, localStream);
    localVideo.srcObject = localStream;
  } else {
    videoTrack.enabled = !videoTrack.enabled;
  }
});

endCallBtn.addEventListener("click", () => {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  location.reload();
});