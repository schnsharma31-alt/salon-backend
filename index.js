const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const DATA_FILE = path.join(__dirname, 'salon_data.json');

function loadData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (e) {}
  return { bookings: [], bills: [] };
}

function saveData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {}
}

// 1. ONLINE BOOKING WEBPAGE (SERVE DIRECT HTML FILE)
app.get(['/', '/book'], (req, res) => {
  res.sendFile(path.join(__dirname, 'booking.html'));
});

// 2. BACKEND APIS
app.post('/api/book', (req, res) => {
  const { name, phone, service, time } = req.body;
  if (!name || !phone || !service || !time) {
    return res.status(400).json({ error: 'All fields required' });
  }
  const db = loadData();
  const newBooking = {
    _id: Date.now().toString(),
    name,
    phone,
    service,
    time,
    date: time.includes('T') ? time.split('T')[0] : time,
    status: 'PENDING',
    createdAt: new Date().toISOString()
  };
  db.bookings.unshift(newBooking);
  saveData(db);
  res.json({ success: true, booking: newBooking });
});

app.get('/api/bookings', (req, res) => {
  const db = loadData();
  res.json(db.bookings || []);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});