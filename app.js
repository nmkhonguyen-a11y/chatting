import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_KEY = "YOUR_SUPABASE_PUBLISHABLE_KEY";
const configured = !SUPABASE_URL.includes("YOUR_") && !SUPABASE_KEY.includes("YOUR_");
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const $ = (id) => document.getElementById(id);
let user = null, profile = null, activeConversation = null, conversations = [];
let messageSubscription = null, voiceChannel = null, localStream = null;
const peers = new Map();
let authMode = "login";

function toast(message) {
  const el = $("toast"); el.textContent = message; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 2600);
}
function initials(name="CV") { return name.trim().slice(0,1).toUpperCase() || "C"; }
function escapeText(value="") {
  return String(value).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function showAuthError(message) { $("authError").textContent = message || ""; }
function setAuthMode(mode) {
  authMode = mode;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("active", b.dataset.auth === mode));
  $("nameLabel").classList.toggle("hidden", mode !== "signup");
  $("authSubmit").textContent = mode === "signup" ? "Tạo tài khoản" : "Đăng nhập";
  $("password").autocomplete = mode === "signup" ? "new-password" : "current-password";
  showAuthError("");
}
document.querySelectorAll(".tab").forEach(b => b.addEventListener("click", () => setAuthMode(b.dataset.auth)));

async function boot() {
  if (!configured) {
    showAuthError("Bạn cần cấu hình SUPABASE_URL và SUPABASE_PUBLISHABLE_KEY trong app.js trước khi sử dụng.");
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterApp(session.user);
}
$("authForm").addEventListener("submit", async e => {
  e.preventDefault(); showAuthError("");
  if (!configured) return showAuthError("Hãy cấu hình Supabase trong app.js trước.");
  const email = $("email").value.trim(), password = $("password").value;
  let result;
  if (authMode === "signup") {
    result = await supabase.auth.signUp({ email, password, options: { data: { display_name: $("displayName").value.trim() || email.split("@")[0] } } });
    if (!result.error && !result.data.session) showAuthError("Đã tạo tài khoản. Hãy xác nhận email rồi đăng nhập.");
  } else result = await supabase.auth.signInWithPassword({ email, password });
  if (result.error) showAuthError(result.error.message);
  else if (result.data.session) await enterApp(result.data.user);
});
$("logoutBtn").addEventListener("click", async () => { await stopVoice(); await supabase.auth.signOut(); location.reload(); });

async function enterApp(authUser) {
  user = authUser;
  const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).single();
  if (error || !data) { toast("Không tải được hồ sơ. Hãy kiểm tra SQL schema."); return; }
  profile = data;
  $("authScreen").classList.add("hidden"); $("app").classList.remove("hidden");
  $("myName").textContent = profile.display_name; $("myId").textContent = `ID: ${profile.public_id}`;
  $("myAvatar").textContent = initials(profile.display_name);
  await loadConversations();
  await loadIncomingRequests();
}

async function loadConversations() {
  const { data: memberships, error } = await supabase.from("conversation_members")
    .select("conversation_id, conversations(id,name,is_group,created_at)")
    .eq("user_id", user.id);
  if (error) return toast("Không tải được danh sách chat.");
  conversations = (memberships || []).map(m => m.conversations).filter(Boolean);
  const { data: friendships } = await supabase.from("friendships").select("user_a,user_b").or(`user_a.eq.${user.id},user_b.eq.${user.id}`);
  for (const f of friendships || []) {
    const friendId = f.user_a === user.id ? f.user_b : f.user_a;
    const { data: p } = await supabase.from("profiles").select("id,display_name,public_id").eq("id", friendId).single();
    if (!p) continue;
    let conv = conversations.find(c => !c.is_group && c.name === `dm:${[user.id, friendId].sort().join(":")}`);
    if (!conv) {
      const { data: found } = await supabase.from("conversations").select("*").eq("name", `dm:${[user.id, friendId].sort().join(":")}`).maybeSingle();
      conv = found;
    }
    if (conv && !conversations.some(c => c.id === conv.id)) conversations.push(conv);
    if (!conv) p._pending = true;
  }
  renderConversationList();
}
function renderConversationList() {
  const list = $("conversationList"); list.innerHTML = "";
  if (!conversations.length) { list.innerHTML = '<div class="empty-small">Chưa có cuộc trò chuyện.<br>Hãy kết bạn hoặc tạo nhóm.</div>'; return; }
  conversations.sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
  conversations.forEach(c => {
    const item = document.createElement("div"); item.className = "conversation-item" + (activeConversation?.id === c.id ? " active" : "");
    item.innerHTML = `<div class="avatar">${c.is_group ? "♧" : initials(c.name?.startsWith("dm:") ? "B" : c.name)}</div><div class="conversation-info"><strong>${escapeText(c.is_group ? c.name : (c.title || "Trò chuyện riêng"))}</strong><small>${c.is_group ? "Nhóm chat" : "Tin nhắn riêng"}</small></div>`;
    item.addEventListener("click", () => openConversation(c)); list.appendChild(item);
  });
}

async function openConversation(conv) {
  if (voiceChannel) await stopVoice();
  activeConversation = conv; $("welcome").classList.add("hidden");
  $("messageList").classList.remove("hidden"); $("messageForm").classList.remove("hidden");
  $("chatTitle").textContent = conv.is_group ? conv.name : (conv.title || "Trò chuyện riêng");
  $("chatSubtitle").textContent = conv.is_group ? "Nhóm chat" : "Cuộc trò chuyện riêng";
  $("chatAvatar").textContent = conv.is_group ? "♧" : "✦";
  $("voiceBtn").disabled = false; renderConversationList();
  if (messageSubscription) await supabase.removeChannel(messageSubscription);
  await loadMessages();
  messageSubscription = supabase.channel(`messages:${conv.id}`)
    .on("postgres_changes", { event:"INSERT", schema:"public", table:"messages", filter:`conversation_id=eq.${conv.id}` }, payload => renderMessage(payload.new))
    .subscribe();
}
async function loadMessages() {
  const { data, error } = await supabase.from("messages").select("id,content,created_at,user_id,profiles(display_name)")
    .eq("conversation_id", activeConversation.id).order("created_at", { ascending:true }).limit(150);
  if (error) { toast("Không tải được tin nhắn."); return; }
  $("messageList").innerHTML = "";
  (data || []).forEach(renderMessage); $("messageList").scrollTop = $("messageList").scrollHeight;
}
function renderMessage(m) {
  if (document.querySelector(`[data-message-id="${m.id}"]`)) return;
  const mine = m.user_id === user.id, name = m.profiles?.display_name || (mine ? profile.display_name : "Thành viên");
  const node = document.createElement("div"); node.className = "message" + (mine ? " mine" : "");
  node.dataset.messageId = m.id;
  const time = new Date(m.created_at).toLocaleTimeString("vi-VN",{hour:"2-digit",minute:"2-digit"});
  node.innerHTML = `<div class="message-meta">${escapeText(name)} · ${time}</div><div class="bubble">${escapeText(m.content)}</div>`;
  $("messageList").appendChild(node); $("messageList").scrollTop = $("messageList").scrollHeight;
}
$("messageForm").addEventListener("submit", async e => {
  e.preventDefault(); if (!activeConversation) return;
  const content = $("messageInput").value.trim(); if (!content) return;
  $("messageInput").value = "";
  const { error } = await supabase.from("messages").insert({ conversation_id:activeConversation.id, user_id:user.id, content });
  if (error) { toast("Gửi tin nhắn thất bại: " + error.message); $("messageInput").value = content; }
});

$("addFriendBtn").addEventListener("click", () => $("friendDialog").showModal());
$("friendForm").addEventListener("submit", async e => {
  e.preventDefault(); const id = $("friendId").value.trim().toUpperCase();
  const { data: target, error } = await supabase.from("profiles").select("id,public_id").eq("public_id", id).maybeSingle();
  if (error || !target) return toast("Không tìm thấy ID tài khoản.");
  if (target.id === user.id) return toast("Bạn không thể tự kết bạn với mình.");
  const { error: sendError } = await supabase.from("friend_requests").insert({ sender_id:user.id, receiver_id:target.id });
  if (sendError) return toast(sendError.code === "23505" ? "Lời mời đã được gửi." : sendError.message);
  $("friendDialog").close(); $("friendId").value = ""; toast("Đã gửi lời mời kết bạn.");
});
async function loadIncomingRequests() {
  const { data } = await supabase.from("friend_requests").select("id,sender_id,profiles!friend_requests_sender_id_fkey(display_name,public_id)").eq("receiver_id", user.id).eq("status","pending");
  (data || []).forEach(r => {
    const accept = confirm(`${r.profiles?.display_name || "Một người dùng"} (${r.profiles?.public_id}) muốn kết bạn. Chấp nhận?`);
    if (accept) acceptFriend(r);
  });
}
async function acceptFriend(r) {
  const { error } = await supabase.from("friendships").insert({ user_a:user.id, user_b:r.sender_id });
  if (!error) {
    await supabase.from("friend_requests").update({status:"accepted"}).eq("id",r.id);
    await ensureDirectConversation(user.id, r.sender_id); await loadConversations(); toast("Đã kết bạn!");
  }
}
async function ensureDirectConversation(a,b) {
  const name = `dm:${[a,b].sort().join(":")}`;
  let { data: conv } = await supabase.from("conversations").select("*").eq("name",name).maybeSingle();
  if (!conv) {
    const { data, error } = await supabase.from("conversations").insert({name,is_group:false}).select().single();
    if (error) return toast(error.message); conv = data;
    await supabase.from("conversation_members").insert([{conversation_id:conv.id,user_id:a},{conversation_id:conv.id,user_id:b}]);
  }
  return conv;
}
$("newGroupBtn").addEventListener("click", () => $("groupDialog").showModal());
$("groupForm").addEventListener("submit", async e => {
  e.preventDefault(); const name = $("groupName").value.trim(); if (!name) return;
  const ids = $("groupMembers").value.split(",").map(x=>x.trim().toUpperCase()).filter(Boolean);
  let members = [user.id];
  if (ids.length) {
    const { data } = await supabase.from("profiles").select("id,public_id").in("public_id",ids);
    members.push(...(data || []).map(x=>x.id));
    if (members.length !== ids.length + 1) return toast("Có ID không tồn tại hoặc bị trùng.");
  }
  const { data: conv, error } = await supabase.from("conversations").insert({name,is_group:true,created_by:user.id}).select().single();
  if (error) return toast(error.message);
  const { error: memberError } = await supabase.from("conversation_members").insert([...new Set(members)].map(id=>({conversation_id:conv.id,user_id:id})));
  if (memberError) return toast(memberError.message);
  $("groupDialog").close(); $("groupName").value=""; $("groupMembers").value="";
  await loadConversations(); openConversation(conv); toast("Đã tạo nhóm chat.");
});

// WebRTC voice mesh: works for small groups; each member needs microphone permission.
$("voiceBtn").addEventListener("click", startVoice);
$("leaveVoiceBtn").addEventListener("click", stopVoice);
async function startVoice() {
  if (!activeConversation || voiceChannel) return;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({audio:true,video:false});
    voiceChannel = supabase.channel(`voice:${activeConversation.id}`, { config:{ private:true, broadcast:{self:false}, presence:{key:user.id} } });
    voiceChannel.on("broadcast",{event:"signal"}, async ({payload}) => handleSignal(payload));
    voiceChannel.on("presence",{event:"sync"}, async () => {
      const state = voiceChannel.presenceState();
      for (const [key, entries] of Object.entries(state)) {
        if (key !== user.id && entries.length && !peers.has(key) && user.id < key) await createPeer(key, true);
      }
    });
    const status = await new Promise(resolve => voiceChannel.subscribe(s => { if (s === "SUBSCRIBED") resolve(true); if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") resolve(false); }));
    if (!status) throw new Error("Không thể kết nối voice channel. Kiểm tra Realtime Authorization SQL.");
    await voiceChannel.track({user_id:user.id, joined_at:new Date().toISOString()});
    $("voiceBtn").classList.add("hidden"); $("leaveVoiceBtn").classList.remove("hidden");
    $("voiceStatus").classList.remove("hidden"); $("voiceStatus").textContent = "🎙 Bạn đang ở trong voice chat — hãy cho phép trình duyệt dùng micro.";
    toast("Đã tham gia voice chat.");
  } catch (err) { await stopVoice(); toast("Không thể bật voice: " + err.message); }
}
async function createPeer(peerId, offerer) {
  if (peers.has(peerId)) return peers.get(peerId);
  const pc = new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});
  peers.set(peerId,pc);
  localStream?.getTracks().forEach(t=>pc.addTrack(t,localStream));
  pc.onicecandidate = e => { if(e.candidate) voiceChannel.send({type:"broadcast",event:"signal",payload:{from:user.id,to:peerId,candidate:e.candidate}}); };
  pc.ontrack = e => {
    let audio = document.getElementById(`audio-${peerId}`);
    if(!audio){audio=document.createElement("audio");audio.id=`audio-${peerId}`;audio.autoplay=true;document.body.appendChild(audio);}
    audio.srcObject=e.streams[0];
  };
  pc.onconnectionstatechange = () => { if(["failed","closed","disconnected"].includes(pc.connectionState)) closePeer(peerId); };
  if (offerer) {
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    await voiceChannel.send({type:"broadcast",event:"signal",payload:{from:user.id,to:peerId,description:pc.localDescription}});
  }
  return pc;
}
async function handleSignal(p) {
  if (!p || p.to !== user.id || !voiceChannel) return;
  const pc = await createPeer(p.from,false);
  if (p.description) {
    await pc.setRemoteDescription(p.description);
    if (p.description.type === "offer") {
      const answer = await pc.createAnswer(); await pc.setLocalDescription(answer);
      await voiceChannel.send({type:"broadcast",event:"signal",payload:{from:user.id,to:p.from,description:pc.localDescription}});
    }
  } else if (p.candidate) {
    try { await pc.addIceCandidate(p.candidate); } catch {}
  }
}
function closePeer(id) {
  const pc=peers.get(id); if(pc) pc.close(); peers.delete(id);
  document.getElementById(`audio-${id}`)?.remove();
}
async function stopVoice() {
  for (const id of [...peers.keys()]) closePeer(id);
  localStream?.getTracks().forEach(t=>t.stop()); localStream=null;
  if (voiceChannel) { await supabase.removeChannel(voiceChannel); voiceChannel=null; }
  $("voiceBtn").classList.remove("hidden"); $("voiceBtn").disabled=!activeConversation;
  $("leaveVoiceBtn").classList.add("hidden"); $("voiceStatus").classList.add("hidden");
}
window.addEventListener("beforeunload", () => { localStream?.getTracks().forEach(t=>t.stop()); });
supabase.auth.onAuthStateChange((event, session) => { if (event === "SIGNED_OUT") location.reload(); });
boot();
