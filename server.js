// Load environment variables
require('dotenv').config();

// Import Dependencies
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const cors = require('cors');

// Initialize App
const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'your-super-secret-key';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '')));

// --- Database Connection ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB Atlas connected successfully.'))
    .catch(err => console.error('MongoDB connection error:', err));

// --- Mongoose Schemas ---
const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    skillsKnown: [{ type: String }],
    skillsWanted: [{ type: String }],
    location: { lat: Number, lng: Number },
    profilePicture: { type: String, default: 'https://via.placeholder.com/150' },
    securityQuestion: { type: String, required: true },
    securityAnswer: { type: String, required: true },
    friends: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    friendRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    reviews: [{
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rating: Number,
        comment: String
    }],
    activityLog: [{
        action: String,
        timestamp: { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
    from: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    to: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', userSchema);
const Message = mongoose.model('Message', messageSchema);

// --- WebSocket (Chat & Signaling) ---
const clients = new Map();

wss.on('connection', (ws, req) => {
    const token = req.url.split('token=')[1];
    if (token) {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            clients.set(decoded.id, ws);
            console.log(`WebSocket Client connected for user: ${decoded.id}`);

            ws.on('message', message => {
                const data = JSON.parse(message);
                if (data.type === 'chat') {
                    const recipientWs = clients.get(data.to);
                    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                        recipientWs.send(JSON.stringify(data));
                    }
                    Message.create({ from: decoded.id, to: data.to, content: data.content });
                }
                if (data.type === 'webrtc-signal') {
                    const recipientWs = clients.get(data.to);
                    if (recipientWs && recipientWs.readyState === WebSocket.OPEN) {
                        recipientWs.send(JSON.stringify({ type: 'webrtc-signal', from: decoded.id, signal: data.signal }));
                    }
                }
            });

            ws.on('close', () => {
                clients.delete(decoded.id);
                console.log(`WebSocket Client disconnected for user: ${decoded.id}`);
            });
        } catch (error) {
            ws.close();
        }
    } else {
        ws.close();
    }
});

// --- API Routes ---
const auth = (req, res, next) => {
    const token = req.header('x-auth-token');
    if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (e) {
        res.status(400).json({ msg: 'Token is not valid' });
    }
};

app.post('/register', async (req, res) => {
    try {
        const { name, email, password, skillsKnown, skillsWanted, securityQuestion, securityAnswer, profilePicture } = req.body;
        let user = await User.findOne({ email });
        if (user) return res.status(400).json({ msg: 'User already exists' });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, 10);
        const hashedAnswer = await bcrypt.hash(securityAnswer.toLowerCase(), salt);

        user = new User({
            name, email, password: hashedPassword, skillsKnown, skillsWanted,
            securityQuestion, securityAnswer: hashedAnswer, profilePicture,
            activityLog: [{ action: 'Account created' }]
        });
        await user.save();
        res.status(201).json({ msg: 'User registered successfully' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(400).json({ msg: 'Invalid credentials' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(400).json({ msg: 'Invalid credentials' });

        const token = jwt.sign({ id: user.id, name: user.name }, JWT_SECRET, { expiresIn: '1h' });
        res.json({ token });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.get('/api/profile', auth, async (req, res) => {
    try {
        const user = await User.findById(req.user.id).select('-password -securityAnswer').populate('friends', 'name skillsKnown').populate('friendRequests', 'name');
        res.json(user);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.get('/api/users', auth, async (req, res) => {
    try {
        const users = await User.find().select('name skillsKnown skillsWanted location profilePicture');
        res.json(users);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.post('/api/friends/request/:id', auth, async (req, res) => {
    try {
        const recipient = await User.findById(req.params.id);
        if (!recipient.friendRequests.includes(req.user.id)) {
            recipient.friendRequests.push(req.user.id);
            await recipient.save();
        }
        res.json({ msg: 'Friend request sent' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.post('/api/friends/accept/:id', auth, async (req, res) => {
    try {
        const requesterId = req.params.id;
        const currentUser = await User.findById(req.user.id);
        
        currentUser.friends.push(requesterId);
        currentUser.friendRequests = currentUser.friendRequests.filter(id => id.toString() !== requesterId);
        await currentUser.save();
        
        const requester = await User.findById(requesterId);
        requester.friends.push(req.user.id);
        await requester.save();

        res.json({ msg: 'Friend added' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.get('/api/messages/:friendId', auth, async (req, res) => {
    try {
        const friendId = req.params.friendId;
        const userId = req.user.id;
        const messages = await Message.find({
            $or: [{ from: userId, to: friendId }, { from: friendId, to: userId }]
        }).sort({ timestamp: 1 });
        res.json(messages);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.post('/forgot-password/question', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ msg: 'User not found' });
        res.json({ securityQuestion: user.securityQuestion });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.post('/forgot-password/reset', async (req, res) => {
    try {
        const { email, securityAnswer, newPassword } = req.body;
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ msg: 'User not found' });

        const isAnswerMatch = await bcrypt.compare(securityAnswer.toLowerCase(), user.securityAnswer);
        if (!isAnswerMatch) return res.status(400).json({ msg: 'Incorrect answer to security question' });

        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(newPassword, salt);
        await user.save();
        res.json({ msg: 'Password has been reset successfully' });
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

app.get('/api/matches', auth, async (req, res) => {
    try {
        const currentUser = await User.findById(req.user.id);
        const matches = await User.find({
            _id: { $ne: req.user.id },
            skillsWanted: { $in: currentUser.skillsKnown },
            skillsKnown: { $in: currentUser.skillsWanted }
        }).select('name skillsKnown skillsWanted profilePicture');
        res.json(matches);
    } catch (err) {
        res.status(500).send('Server Error');
    }
});

// --- Final Setup ---
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

server.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));