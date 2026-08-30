import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword, 
  signInWithPopup, 
  GoogleAuthProvider, 
  signOut, 
  onAuthStateChanged 
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
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

const firebaseConfig = {
  apiKey: "AIzaSyDS9A2CqtnY3-2vv9KmNDPUl5sXifxrmYM",
  authDomain: "sleek-chat-app-47b2a.firebaseapp.com",
  projectId: "sleek-chat-app-47b2a",
  storageBucket: "sleek-chat-app-47b2a.firebasestorage.app",
  messagingSenderId: "830967591682",
  appId: "1:830967591682:web:5d7038480abeadbd64081b"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);

// Global State
let currentUser = null;
let currentRoom = "general";
let peerConnection = null;
let localStream = null;
let remoteStream = null;
let isMuted = false;
let isScreenSharing = false;

// DOM Controls
const authOverlay = document.getElementById("authOverlay");
const authEmail = document.getElementById("authEmail");
const authPassword = document.getElementById("authPassword");
const loginBtn = document.getElementById("loginBtn");
const signupBtn = document.getElementById("signupBtn");
const googleAuthBtn = document.getElementById("googleAuthBtn");
const logoutBtn = document.getElementById("logoutBtn");

const userInfoCard = document.getElementById("userInfoCard");
const userAvatar = document.getElementById("userAvatar");
const userName = document.getElementById("userName");

const roomSelect = document.getElementById("roomSelect");
const currentRoomTitle = document.getElementById("currentRoomTitle");
const messagesContainer = document.getElementById("messagesContainer");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const typingIndicator = document.getElementById("typingIndicator");

const uploadImageBtn = document.getElementById("uploadImageBtn");
const imageFileInput = document.getElementById("imageFileInput");
const voiceMsgBtn = document.getElementById("voiceMsgBtn");

const startCallBtn = document.getElementById("startCallBtn");
const acceptCallBtn = document.getElementById("acceptCallBtn");
const rejectCallBtn = document.getElementById("rejectCallBtn");
const endCallBtn = document.getElementById("endCallBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const toggleMicBtn = document.getElementById("toggleMicBtn");
const screenShareBtn = document.getElementById("screenShareBtn");
const themeToggleBtn = document.getElementById("themeToggleBtn");

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const mediaPlaceholder = document.getElementById("mediaPlaceholder");
const incomingCallModal = document.getElementById("incomingCallModal");

// --- 1. Authentication Handlers ---
loginBtn.addEventListener("click", async () => {
  if (!authEmail.value || !authPassword.value) return alert("Please fill in email and password.");
  try {
    await signInWithEmailAndPassword(auth, authEmail.value, authPassword.value);
  } catch (err) { alert("Login failed: " + err.message); }
});

signupBtn.addEventListener("click", async () => {
  if (!authEmail.value || !authPassword.value) return alert("Please fill in email and password.");
  try {
    await createUserWithEmailAndPassword(auth, authEmail.value, authPassword.value);
  } catch (err) { alert("Signup failed: " + err.message); }
});

googleAuthBtn.addEventListener("click", async () => {
  try {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  } catch (err) { alert("Google Auth failed: " + err.message); }
});

logoutBtn.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (user) {
    authOverlay.classList.add("hidden");
    userInfoCard.classList.remove("hidden");
    userName.textContent = user.displayName || user.email.split('@')[0];
    userAvatar.src = user.photoURL || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.uid}`;
    listenToMessages();
    listenForIncomingCalls();
  } else {
    if (localStream) localStream.getTracks().forEach(t => t.stop());
    if (peerConnection) peerConnection.close();
    authOverlay.classList.remove("hidden");
    userInfoCard.classList.add("hidden");
  }
});

// --- 2. Multi-Room Chat System ---
roomSelect.addEventListener("change", (e) => {
  currentRoom = e.target.value;
  currentRoomTitle.textContent = `# ${e.target.options[e.target.selectedIndex].text}`;
  listenToMessages();
});

let unsubscribeMessages = null;
function listenToMessages() {
  if (unsubscribeMessages) unsubscribeMessages();
  const roomMessagesRef = collection(db, `rooms/${currentRoom}/messages`);
  const q = query(roomMessagesRef, orderBy("timestamp", "asc"));

  unsubscribeMessages = onSnapshot(q, (snapshot) => {
    messagesContainer.innerHTML = "";
    
    // Convert snapshots and apply stable fallback sorting
    const docs = [];
    snapshot.forEach(docSnap => docs.push({ id: docSnap.id, data: docSnap.data() }));
    docs.sort((a, b) => {
      const timeA = a.data.timestamp ? a.data.timestamp.toMillis() : Date.now();
      const timeB = b.data.timestamp ? b.data.timestamp.toMillis() : Date.now();
      return timeA - timeB;
    });

    docs.forEach(({ id, data }) => {
      const isOwner = currentUser && data.senderId === currentUser.uid;

      const div = document.createElement("div");
      div.className = `message-bubble ${isOwner ? 'sent' : 'received'}`;

      let mediaHtml = '';
      if (data.imageUrl) {
        mediaHtml = `<img src="${data.imageUrl}" class="msg-image" />`;
      } else if (data.audioUrl) {
        mediaHtml = `<audio controls src="${data.audioUrl}"></audio>`;
      }

      const formattedTime = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : 'Sending...';

      div.innerHTML = `
        <span class="msg-author">${data.senderName || 'Anonymous'}</span>
        ${data.text ? `<div>${escapeHtml(data.text)}</div>` : ''}
        ${mediaHtml}
        <div class="msg-footer">
          <span>${formattedTime}</span>
          ${isOwner ? `<button class="delete-btn" data-id="${id}">Delete</button>` : ''}
        </div>
      `;
      messagesContainer.appendChild(div);
    });
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  });
}

// Delete Message
messagesContainer.addEventListener("click", async (e) => {
  if (e.target.classList.contains("delete-btn")) {
    const msgId = e.target.getAttribute("data-id");
    try {
      await deleteDoc(doc(db, `rooms/${currentRoom}/messages`, msgId));
    } catch (err) { console.error("Error deleting message:", err); }
  }
});

// Send Text Message
async function sendMessage() {
  const text = messageInput.value.trim();
  if (!text || !currentUser) return;
  try {
    messageInput.value = "";
    await addDoc(collection(db, `rooms/${currentRoom}/messages`), {
      text: text,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email.split('@')[0],
      timestamp: serverTimestamp()
    });
  } catch (err) { console.error("Send message error:", err); }
}
sendBtn.addEventListener("click", sendMessage);
messageInput.addEventListener("keypress", (e) => { if (e.key === "Enter") sendMessage(); });

// Image Upload
uploadImageBtn.addEventListener("click", () => imageFileInput.click());
imageFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file || !currentUser) return;
  try {
    const storageRef = ref(storage, `chat_images/${Date.now()}_${file.name}`);
    await uploadBytes(storageRef, file);
    const url = await getDownloadURL(storageRef);
    await addDoc(collection(db, `rooms/${currentRoom}/messages`), {
      imageUrl: url,
      senderId: currentUser.uid,
      senderName: currentUser.displayName || currentUser.email.split('@')[0],
      timestamp: serverTimestamp()
    });
  } catch (err) { alert("Image upload failed: " + err.message); }
});

// Voice Notes
let mediaRecorder = null, audioChunks = [];
voiceMsgBtn.addEventListener("click", async () => {
  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(stream);
      audioChunks = [];
      mediaRecorder.ondataavailable = e => audioChunks.push(e.data);
      mediaRecorder.onstop = async () => {
        try {
          const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
          const storageRef = ref(storage, `voice_notes/${Date.now()}.webm`);
          await uploadBytes(storageRef, audioBlob);
          const url = await getDownloadURL(storageRef);
          await addDoc(collection(db, `rooms/${currentRoom}/messages`), {
            audioUrl: url,
            senderId: currentUser.uid,
            senderName: currentUser.displayName || currentUser.email.split('@')[0],
            timestamp: serverTimestamp()
          });
        } catch (err) { alert("Voice note upload failed: " + err.message); }
      };
      mediaRecorder.start();
      voiceMsgBtn.style.background = "rgba(244, 63, 94, 0.3)";
    } catch (err) { alert("Microphone access denied."); }
  } else {
    mediaRecorder.stop();
    voiceMsgBtn.style.background = "";
  }
});

// Typing Indicators
let typingTimeout = null;
messageInput.addEventListener("input", () => {
  if (!currentUser) return;
  setDoc(doc(db, `rooms/${currentRoom}/typing`, currentUser.uid), {
    name: currentUser.displayName || currentUser.email.split('@')[0],
    typing: true
  });
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(() => {
    if (currentUser) {
      deleteDoc(doc(db, `rooms/${currentRoom}/typing`, currentUser.uid)).catch(() => {});
    }
  }, 2000);
});

onSnapshot(collection(db, `rooms/${currentRoom}/typing`), (snapshot) => {
  const typers = [];
  snapshot.forEach(d => {
    if (d.id !== currentUser?.uid && d.data().typing) typers.push(d.data().name);
  });
  typingIndicator.textContent = typers.length ? `${typers.join(", ")} typing...` : "";
});

// --- 3. WebRTC Calling & Screen Share ---
const servers = { iceServers: [{ urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'] }] };
const callDocId = "globalActiveSession";

startCallBtn.addEventListener("click", async () => {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localVideo.srcObject = localStream;
    mediaPlaceholder.style.display = "none";

    peerConnection = new RTCPeerConnection(servers);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = e => e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));

    const callDoc = doc(collection(db, "calls"), callDocId);
    const offerCandidates = collection(callDoc, "offerCandidates");
    const answerCandidates = collection(callDoc, "answerCandidates");

    peerConnection.onicecandidate = e => e.candidate && addDoc(offerCandidates, e.candidate.toJSON());

    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    await setDoc(callDoc, { 
      offer, 
      status: "calling",
      callerName: currentUser ? (currentUser.displayName || currentUser.email.split('@')[0]) : "Unknown"
    });

    onSnapshot(callDoc, async (snap) => {
      const data = snap.data();
      if (peerConnection && !peerConnection.currentRemoteDescription && data?.answer) {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    onSnapshot(answerCandidates, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === "added" && peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });

    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    toggleCameraBtn.disabled = false;
    toggleMicBtn.disabled = false;
    screenShareBtn.disabled = false;
  } catch (err) { alert("Call start error: " + err.message); }
});

function listenForIncomingCalls() {
  onSnapshot(doc(collection(db, "calls"), callDocId), (snap) => {
    const data = snap.data();
    if (data?.offer && !peerConnection && data?.status === "calling") {
      document.getElementById("incomingCallerName").textContent = `${data.callerName || 'Someone'} is calling...`;
      incomingCallModal.classList.remove("hidden");
    }
  });
}

acceptCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    localVideo.srcObject = localStream;
    mediaPlaceholder.style.display = "none";

    peerConnection = new RTCPeerConnection(servers);
    remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;

    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = e => e.streams[0].getTracks().forEach(t => remoteStream.addTrack(t));

    const callDoc = doc(collection(db, "calls"), callDocId);
    const answerCandidates = collection(callDoc, "answerCandidates");
    const offerCandidates = collection(callDoc, "offerCandidates");

    peerConnection.onicecandidate = e => e.candidate && addDoc(answerCandidates, e.candidate.toJSON());

    const callSnap = await getDoc(callDoc);
    await peerConnection.setRemoteDescription(new RTCSessionDescription(callSnap.data().offer));

    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await updateDoc(callDoc, { answer, status: "connected" });

    onSnapshot(offerCandidates, snap => {
      snap.docChanges().forEach(async change => {
        if (change.type === "added" && peerConnection && peerConnection.remoteDescription) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(change.doc.data()));
        }
      });
    });

    startCallBtn.disabled = true;
    endCallBtn.disabled = false;
    toggleCameraBtn.disabled = false;
    toggleMicBtn.disabled = false;
    screenShareBtn.disabled = false;
  } catch (err) { alert("Call accept error: " + err.message); }
});

rejectCallBtn.addEventListener("click", async () => {
  incomingCallModal.classList.add("hidden");
  try {
    await updateDoc(doc(collection(db, "calls"), callDocId), { offer: null, status: "rejected" });
  } catch(e) {}
});

// Screen Share Toggle
screenShareBtn.addEventListener("click", async () => {
  if (!isScreenSharing) {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const screenTrack = screenStream.getVideoTracks()[0];
      const sender = peerConnection ? peerConnection.getSenders().find(s => s.track?.kind === 'video') : null;
      if (sender) {
        sender.replaceTrack(screenTrack);
      } else if (peerConnection) {
        peerConnection.addTrack(screenTrack, localStream);
      }

      localVideo.srcObject = screenStream;
      isScreenSharing = true;
      screenShareBtn.style.background = "var(--accent)";

      screenTrack.onended = () => stopScreenShare();
    } catch (err) { console.error(err); }
  } else {
    stopScreenShare();
  }
});

function stopScreenShare() {
  const videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
  const sender = peerConnection ? peerConnection.getSenders().find(s => s.track?.kind === 'video') : null;
  if (sender && videoTrack) sender.replaceTrack(videoTrack);
  localVideo.srcObject = localStream;
  isScreenSharing = false;
  screenShareBtn.style.background = "";
}

// Camera Toggle
toggleCameraBtn.addEventListener("click", async () => {
  let videoTrack = localStream ? localStream.getVideoTracks()[0] : null;
  if (!videoTrack) {
    try {
      const camStream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoTrack = camStream.getVideoTracks()[0];
      if (localStream) localStream.addTrack(videoTrack);
      
      const sender = peerConnection ? peerConnection.getSenders().find(s => s.track && s.track.kind === 'video') : null;
      if (sender) {
        sender.replaceTrack(videoTrack);
      } else if (peerConnection) {
        peerConnection.addTrack(videoTrack, localStream);
      }
      localVideo.srcObject = localStream;
    } catch (err) { alert("Camera access denied."); }
  } else {
    videoTrack.enabled = !videoTrack.enabled;
  }
});

// Mic Mute Toggle
toggleMicBtn.addEventListener("click", () => {
  const audioTrack = localStream ? localStream.getAudioTracks()[0] : null;
  if (audioTrack) {
    isMuted = !isMuted;
    audioTrack.enabled = !isMuted;
    toggleMicBtn.style.background = isMuted ? "var(--danger)" : "";
  }
});

// Theme Toggle
themeToggleBtn.addEventListener("click", () => {
  document.body.classList.toggle("theme-light");
});

// Hang Up
endCallBtn.addEventListener("click", () => {
  if (peerConnection) peerConnection.close();
  if (localStream) localStream.getTracks().forEach(t => t.stop());
  location.reload();
});

function escapeHtml(text) {
  return text.replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}