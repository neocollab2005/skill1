document.addEventListener('DOMContentLoaded', () => {
    const token = localStorage.getItem('token');
    const path = window.location.pathname;

    // --- Global Helpers ---
    const api = async (endpoint, method = 'GET', body = null) => {
        const options = {
            method,
            headers: { 'Content-Type': 'application/json', 'x-auth-token': token }
        };
        if (body) options.body = JSON.stringify(body);
        const response = await fetch(endpoint, options);
        if (!response.ok) {
            const error = await response.json();
            alert(`Error: ${error.msg}`);
            if (response.status === 401) window.location.href = '/login.html'; // Redirect on auth failure
            throw new Error(error.msg);
        }
        return response.json();
    };

    // --- Page-specific Logic ---

    // Registration Page
    if (path.includes('register.html')) {
        const form = document.getElementById('register-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());
            data.skillsKnown = data.skillsKnown.split(',').map(s => s.trim());
            data.skillsWanted = data.skillsWanted.split(',').map(s => s.trim());
            
            try {
                await api('/register', 'POST', data);
                alert('Registration successful! Please login.'); // This message is already here
                window.location.href = '/login.html';
            } catch (err) {
                console.error('Registration failed:', err);
            }
        });
    }

    // Login Page
    if (path.includes('login.html')) {
        const form = document.getElementById('login-form');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const data = Object.fromEntries(formData.entries());
            try {
                const result = await api('/login', 'POST', data);
                localStorage.setItem('token', result.token);
                
                // *** NEW: Added success message before redirecting ***
                alert('Login successful! Redirecting to your dashboard...'); 
                
                window.location.href = '/dashboard.html';
            } catch (err) {
                console.error('Login failed:', err);
            }
        });
    }

    // Dashboard Page
    if (path.includes('dashboard.html')) {
        if (!token) window.location.href = '/login.html';

        let ws; // WebSocket connection
        let peerConnection; // WebRTC peer connection
        let localStream;
        let selectedFriendId;
        const localVideo = document.getElementById('local-video');
        const remoteVideo = document.getElementById('remote-video');

        const connectWebSocket = () => {
            ws = new WebSocket(`ws://${window.location.host}?token=${token}`);
            
            ws.onopen = () => console.log('WebSocket connected');
            ws.onclose = () => console.log('WebSocket disconnected');

            ws.onmessage = (event) => {
                const data = JSON.parse(event.data);
                if (data.type === 'chat') {
                    if (data.from === selectedFriendId) {
                        displayMessage(data.content, 'received');
                    }
                }
                if (data.type === 'webrtc-signal') {
                    handleSignalingData(data);
                }
            };
        };

        const loadDashboard = async () => {
            try {
                const profile = await api('/api/profile');
                document.getElementById('welcome-message').textContent = `Welcome, ${profile.name}!`;
                document.getElementById('profile-pic').src = profile.profilePicture || 'https://via.placeholder.com/150';
                document.getElementById('profile-name').textContent = profile.name;
                
                const skillsKnownList = document.getElementById('skills-known-list');
                skillsKnownList.innerHTML = ''; // Clear list before adding
                profile.skillsKnown.forEach(skill => skillsKnownList.innerHTML += `<li>${skill}</li>`);
                
                const skillsWantedList = document.getElementById('skills-wanted-list');
                skillsWantedList.innerHTML = ''; // Clear list
                profile.skillsWanted.forEach(skill => skillsWantedList.innerHTML += `<li>${skill}</li>`);

                const notificationsList = document.getElementById('notifications-list');
                notificationsList.innerHTML = '';
                if (profile.friendRequests.length === 0) {
                    notificationsList.innerHTML = '<p>No new notifications.</p>';
                } else {
                    profile.friendRequests.forEach(req => {
                        notificationsList.innerHTML += `
                            <div class="list-item">
                                <span>${req.name} sent you a friend request.</span>
                                <button class="btn btn-success" onclick="acceptFriendRequest('${req._id}')">Accept</button>
                            </div>`;
                    });
                }
                
                const friendsList = document.getElementById('friends-list');
                friendsList.innerHTML = '';
                if (profile.friends.length === 0) {
                    friendsList.innerHTML = '<p>Find friends in the community!</p>';
                } else {
                    profile.friends.forEach(friend => {
                        const friendItem = document.createElement('div');
                        friendItem.className = 'list-item';
                        friendItem.textContent = friend.name;
                        friendItem.dataset.friendId = friend._id;
                        friendItem.onclick = () => openChat(friend._id, friend.name);
                        friendsList.appendChild(friendItem);
                    });
                }

                const matches = await api('/api/matches');
                const matchesList = document.getElementById('matches-list');
                matchesList.innerHTML = '';
                 if (matches.length === 0) {
                    matchesList.innerHTML = '<p>No perfect matches found yet.</p>';
                } else {
                    matches.forEach(match => {
                        matchesList.innerHTML += `<div class="list-item">${match.name}</div>`;
                    });
                }

                 connectWebSocket();

            } catch (err) {
                console.error('Failed to load dashboard:', err);
            }
        };

        window.acceptFriendRequest = async (id) => {
            try {
                await api(`/api/friends/accept/${id}`, 'POST');
                alert('Friend added!');
                loadDashboard();
            } catch (err) {
                console.error('Failed to accept friend request:', err);
            }
        };
        
        window.openChat = async (friendId, friendName) => {
            // Highlight selected friend
            document.querySelectorAll('#friends-list .list-item').forEach(item => {
                item.classList.toggle('active', item.dataset.friendId === friendId);
            });
            
            selectedFriendId = friendId;
            document.getElementById('chat-window').classList.remove('hidden');
            document.getElementById('chat-with-name').textContent = `Chat with ${friendName}`;
            
            document.getElementById('video-call-controls').classList.remove('hidden');
            
            const messages = await api(`/api/messages/${friendId}`);
            const messagesDiv = document.getElementById('chat-messages');
            messagesDiv.innerHTML = '';
            messages.forEach(msg => {
                const type = msg.from === selectedFriendId ? 'received' : 'sent';
                displayMessage(msg.content, type);
            });
        };

        const displayMessage = (content, type) => {
            const messagesDiv = document.getElementById('chat-messages');
            messagesDiv.innerHTML += `<div class="message ${type}"><p>${content}</p></div>`;
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        };
        
        document.getElementById('chat-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const input = document.getElementById('chat-input');
            const message = input.value;
            if (message && selectedFriendId) {
                ws.send(JSON.stringify({ type: 'chat', to: selectedFriendId, content: message }));
                displayMessage(message, 'sent');
                input.value = '';
            }
        });

        const rtcConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
        
        const createPeerConnection = async () => {
            peerConnection = new RTCPeerConnection(rtcConfig);
            
            peerConnection.onicecandidate = (event) => {
                if (event.candidate) {
                    ws.send(JSON.stringify({ type: 'webrtc-signal', to: selectedFriendId, signal: { candidate: event.candidate } }));
                }
            };
            
            peerConnection.ontrack = (event) => {
                remoteVideo.srcObject = event.streams[0];
            };

            localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            localVideo.srcObject = localStream;
            localStream.getTracks().forEach(track => peerConnection.addTrack(track, localStream));
        };
        
        const handleSignalingData = async (data) => {
            if (!peerConnection) await createPeerConnection();
            
            if (data.signal.offer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.offer));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                ws.send(JSON.stringify({ type: 'webrtc-signal', to: data.from, signal: { answer: answer } }));
            } else if (data.signal.answer) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(data.signal.answer));
            } else if (data.signal.candidate) {
                await peerConnection.addIceCandidate(new RTCIceCandidate(data.signal.candidate));
            }
        };

        document.getElementById('start-call-btn').onclick = async () => {
            if (!selectedFriendId) {
                alert("Please select a friend to call.");
                return;
            }
            alert(`Calling ${document.querySelector('#friends-list .active').textContent}...`);
            await createPeerConnection();
            const offer = await peerConnection.createOffer();
            await peerConnection.setLocalDescription(offer);
            ws.send(JSON.stringify({ type: 'webrtc-signal', to: selectedFriendId, signal: { offer: offer } }));
            document.getElementById('end-call-btn').classList.remove('hidden');
        };
        
        document.getElementById('end-call-btn').onclick = () => {
            if (peerConnection) peerConnection.close();
            if (localStream) localStream.getTracks().forEach(track => track.stop());
            localVideo.srcObject = null;
            remoteVideo.srcObject = null;
            document.getElementById('end-call-btn').classList.add('hidden');
        };

        document.getElementById('logout-btn').addEventListener('click', () => {
            localStorage.removeItem('token');
            window.location.href = '/index.html';
        });

        loadDashboard();
    }
    
    // Community Page
    if (path.includes('community.html')) {
        if (!token) window.location.href = '/login.html';
        let allUsers = [];

        const renderUsers = (users) => {
            const container = document.getElementById('user-list-container');
            container.innerHTML = '';
            if (users.length === 0) {
                container.innerHTML = '<p>No users found matching your search.</p>';
            } else {
                users.forEach(user => {
                    container.innerHTML += `
                        <div class="card user-card">
                            <img src="${user.profilePicture || 'https://via.placeholder.com/150'}" alt="Profile" class="profile-img">
                            <h3>${user.name}</h3>
                            <div class="skills-container">
                                 <div><h4>Has</h4> <ul class="skills-list">${user.skillsKnown.map(s => `<li>${s}</li>`).join('')}</ul></div>
                                 <div><h4>Wants</h4> <ul class="skills-list">${user.skillsWanted.map(s => `<li>${s}</li>`).join('')}</ul></div>
                            </div>
                            <button class="btn btn-primary" onclick="sendFriendRequest('${user._id}')">Connect</button>
                        </div>
                    `;
                });
            }
        };
        
        const map = L.map('map').setView([20, 0], 2); // Global centered view
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap'
        }).addTo(map);

        const loadCommunity = async () => {
            allUsers = await api('/api/users');
            renderUsers(allUsers);
            allUsers.forEach(user => {
                if (user.location && user.location.lat && user.location.lng) {
                    L.marker([user.location.lat, user.location.lng]).addTo(map)
                        .bindPopup(`<b>${user.name}</b>`);
                }
            });
        };

        document.getElementById('search-input').addEventListener('input', (e) => {
            const query = e.target.value.toLowerCase();
            const filteredUsers = allUsers.filter(user => 
                user.name.toLowerCase().includes(query) ||
                user.skillsKnown.some(skill => skill.toLowerCase().includes(query)) ||
                user.skillsWanted.some(skill => skill.toLowerCase().includes(query))
            );
            renderUsers(filteredUsers);
        });
        
        window.sendFriendRequest = async (id) => {
            try {
                await api(`/api/friends/request/${id}`, 'POST');
                alert('Friend request sent!');
            } catch (err) {
                console.error('Failed to send friend request:', err);
            }
        };

        loadCommunity();
    }
});