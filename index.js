const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const billsCache = new Map();
let bookings = [];
const backupFile = path.join(__dirname, 'cloud_bills.json');

if (fs.existsSync(backupFile)) {
  try {
    const raw = fs.readFileSync(backupFile, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.bills) Object.keys(parsed.bills).forEach(k => billsCache.set(k, parsed.bills[k]));
    if (parsed.bookings) bookings = parsed.bookings;
  } catch (e) {}
}

function saveBackup() {
  try {
    const obj = { bills: {}, bookings: bookings };
    billsCache.forEach((v, k) => { obj.bills[k] = v; });
    fs.writeFileSync(backupFile, JSON.stringify(obj, null, 2));
  } catch (e) {}
}

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
}

// 1. Online Booking Form Webpage (Customer WhatsApp par yahi kholega)
app.get('/book', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Book Appointment - Sakshi Makeover</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f8fafc; margin: 0; padding: 15px; }
    .card { max-width: 440px; margin: auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .header { text-align: center; margin-bottom: 20px; }
    .header h2 { margin: 0; color: #0F766E; font-size: 20px; }
    .header p { margin: 4px 0; color: #64748b; font-size: 12px; }
    label { display: block; font-size: 12px; font-weight: bold; color: #334155; margin-top: 14px; margin-bottom: 4px; }
    input, select { width: 100%; box-sizing: border-box; padding: 10px; border: 1.5px solid #cbd5e1; border-radius: 8px; font-size: 14px; outline: none; }
    input:focus, select:focus { border-color: #0F766E; }
    button { width: 100%; margin-top: 24px; padding: 14px; background: #0F766E; color: #fff; border: none; border-radius: 10px; font-size: 15px; font-weight: bold; cursor: pointer; }
    .success { display: none; text-align: center; padding: 20px; color: #0F766E; }
  </style>
</head>
<body>
  <div class="card" id="formCard">
    <div class="header">
      <h2>Sakshi Makeover & Unisex Salon</h2>
      <p>Laxmi Nagar, Delhi | Book Your Slot Online</p>
    </div>
    <form id="bookForm">
      <label>Your Name</label>
      <input type="text" id="name" required placeholder="Enter your full name">

      <label>WhatsApp Number</label>
      <input type="tel" id="phone" required placeholder="10-digit mobile number">

      <label>Preferred Service</label>
      <input type="text" id="service" required placeholder="e.g. Haircut, Facial, Keratin">

      <label>Preferred Date & Time</label>
      <input type="datetime-local" id="time" required>

      <button type="submit">Confirm Appointment 📅</button>
    </form>
  </div>
  <div class="card success" id="successCard">
    <h2>🎉 Appointment Received!</h2>
    <p>Thank you! Your booking request has been forwarded to <b>Sakshi Makeover & Unisex Salon</b>.</p>
    <p style="font-size: 12px; color: #64748b;">We look forward to seeing you!</p>
  </div>
  <script>
    document.getElementById('bookForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('name').value,
        phone: document.getElementById('phone').value,
        service: document.getElementById('service').value,
        time: document.getElementById('time').value
      };
      const res = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        document.getElementById('formCard').style.display = 'none';
        document.getElementById('successCard').style.display = 'block';
      }
    });
  </script>
</body>
</html>
  `);
});

// 2. Booking Save API
app.post('/api/book', (req, res) => {
  const { name, phone, service, time } = req.body;
  const newBooking = {
    id: Date.now().toString(),
    name: name || 'Guest',
    phone: phone || '',
    service: service || 'General',
    time: time || new Date().toISOString(),
    status: 'PENDING'
  };
  bookings.unshift(newBooking);
  saveBackup();
  res.json({ success: true, booking: newBooking });
});

// 3. POS App ke liye Bookings List API
app.get('/api/bookings', (req, res) => {
  res.json(bookings);
});

// Save Bill API
app.post('/api/save-bill', async (req, res) => {
  try {
    const { customerName, customerPhone, subtotal, discountAmount, discount, grandTotal, paymentMode, invoiceNumber, items } = req.body;
    const invNo = invoiceNumber || ('INV-' + Date.now().toString().slice(-4));
    const disc = discountAmount || discount || 0;
    const billData = {
      invoiceNumber: invNo,
      customerName: customerName || 'Valued Customer',
      customerPhone: customerPhone || '',
      subtotal: Number(subtotal || 0),
      discount: Number(disc),
      grandTotal: Number(grandTotal || 0),
      paymentMode: paymentMode || 'CASH',
      items: Array.isArray(items) ? items : [],
      date: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
    };
    billsCache.set(invNo, billData);
    saveBackup();
    res.json({ success: true, invoiceNumber: invNo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Customer search API
app.get('/api/customer/:phone', async (req, res) => {
  const phone = req.params.phone;
  for (const b of billsCache.values()) {
    if (b.customerPhone && b.customerPhone.endsWith(phone)) {
      return res.json({ name: b.customerName, visits: 1, totalSpent: b.grandTotal });
    }
  }
  res.status(404).json({ message: 'Customer not found' });
});

// Web Invoice HTML View
app.get('/invoice/:id', (req, res) => {
  const invId = req.params.id;
  const bill = billsCache.get(invId);
  if (!bill) {
    return res.status(404).send('<div style="text-align:center;padding:50px;"><h2>Invoice Not Found</h2></div>');
  }
  const itemsHtml = bill.items.map(it => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 8px;">${it.name || it.item_name || 'Service'}</td>
      <td style="padding: 10px 8px; text-align: center;">${it.qty || 1}</td>
      <td style="padding: 10px 8px; text-align: right;">Rs. ${Number(it.price || 0).toFixed(0)}</td>
      <td style="padding: 10px 8px; text-align: right; font-weight: bold;">Rs. ${(Number(it.price || 0) * (it.qty || 1)).toFixed(0)}</td>
    </tr>
  `).join('');

  res.send(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice #${bill.invoiceNumber} - Sakshi Makeover</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f1f5f9; margin: 0; padding: 15px; }
    .card { max-width: 480px; margin: auto; background: #fff; border-radius: 14px; padding: 24px; box-shadow: 0 4px 14px rgba(0,0,0,0.08); }
    .header { text-align: center; border-bottom: 2px dashed #cbd5e1; padding-bottom: 16px; margin-bottom: 16px; }
    .header h2 { margin: 0; color: #0F766E; font-size: 20px; }
    .header p { margin: 4px 0; color: #64748b; font-size: 11px; }
    .meta { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; background: #f8fafc; padding: 8px; color: #475569; font-size: 11px; }
    .total-box { margin-top: 16px; border-top: 2px solid #e2e8f0; padding-top: 12px; font-size: 13px; }
    .total-row { display: flex; justify-content: space-between; margin-bottom: 6px; }
    .grand { font-size: 18px; font-weight: bold; color: #0F766E; border-top: 1px dashed #cbd5e1; padding-top: 8px; margin-top: 8px; }
    .footer { text-align: center; margin-top: 24px; font-size: 11px; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <h2>SAKSHI MAKEOVER & UNISEX SALON</h2>
      <p>R-9 Opp. Bagga Jewellers, Shakarpur Main Market, Laxmi Nagar, Delhi - 110092</p>
      <p>Contact: +91 8745869645</p>
    </div>
    <div class="meta">
      <div><strong>Invoice: #${bill.invoiceNumber}</strong><br><span>Date: ${bill.date}</span></div>
      <div style="text-align: right;"><strong>Customer: ${bill.customerName}</strong><br><span>Phone: ${bill.customerPhone}</span></div>
    </div>
    <table>
      <thead><tr><th>Service / Product</th><th style="text-align: center;">Qty</th><th style="text-align: right;">Price</th><th style="text-align: right;">Total</th></tr></thead>
      <tbody>${itemsHtml}</tbody>
    </table>
    <div class="total-box">
      <div class="total-row"><span>Subtotal:</span><span>Rs. ${bill.subtotal.toFixed(2)}</span></div>
      ${bill.discount > 0 ? `<div class="total-row" style="color: #ef4444;"><span>Discount:</span><span>- Rs. ${bill.discount.toFixed(2)}</span></div>` : ''}
      <div class="total-row grand"><span>Total Paid:</span><span>Rs. ${bill.grandTotal.toFixed(2)}</span></div>
    </div>
    <div class="footer"><p>🌸 Thank you for visiting! ✨</p></div>
  </div>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
