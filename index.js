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

      <label style="display:block; margin-bottom: 6px; font-weight: bold; color: #1e293b;">Preferred Services (Add Services & Quantity)</label>
          <input type="hidden" id="service" required>
          
          <!-- SEARCH BOX -->
          <input type="text" id="serviceSearch" placeholder="🔍 Type to search service (e.g. Makeup, Facial, Waxing)..." oninput="filterServices()" style="margin-bottom: 8px;">

          <!-- SELECTED SERVICES DISPLAY -->
          <div id="selectedServicesContainer" style="display: none; background: #f1f5f9; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 10px; margin-bottom: 10px;">
            <div style="font-size: 11px; font-weight: bold; color: #475569; margin-bottom: 6px; letter-spacing: 0.5px;">SELECTED SERVICES:</div>
            <div id="selectedServicesList"></div>
          </div>

          <!-- SERVICES CATALOG LIST -->
          <div id="catalogList" style="max-height: 180px; overflow-y: auto; border: 1.5px solid #cbd5e1; border-radius: 8px; padding: 4px; background: #fff; margin-bottom: 14px;"></div>

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
const salonServices = [
        // Men's Grooming
        { name: "Haircut (Men)", cat: "Men's Grooming", price: 120 },
        { name: "Clean Shave", cat: "Men's Grooming", price: 60 },
        { name: "Beard Trim & Styling", cat: "Men's Grooming", price: 80 },
        { name: "Head Massage (Oil)", cat: "Men's Grooming", price: 150 },
        
        // Thread Work & Waxing
        { name: "Threading (Eyebrows)", cat: "Thread Work", price: 30 },
        { name: "Upper Lip Threading", cat: "Thread Work", price: 20 },
        { name: "Full Face Wax", cat: "Waxing", price: 250 },
        { name: "Underarms Wax (Normal)", cat: "Waxing", price: 60 },
        { name: "Full Arms Wax (RICA)", cat: "Waxing", price: 350 },
        { name: "Full Legs Wax (RICA)", cat: "Waxing", price: 600 },
        
        // Clean-Up & Facial
        { name: "Fruit Clean-Up", cat: "Clean-Up", price: 299 },
        { name: "D-Tan Clean-Up", cat: "Clean-Up", price: 399 },
        { name: "Fruit Facial", cat: "Facial", price: 499 },
        { name: "Gold Radiance Facial", cat: "Facial", price: 799 },
        { name: "O3+ Bridal Glow Facial", cat: "Facial", price: 1499 },
        
        // Makeup & Styling
        { name: "Party Makeup", cat: "Makeup & Styling", price: 2000 },
        { name: "Engagement Makeup", cat: "Makeup & Styling", price: 4500 },
        { name: "Bridal Makeup", cat: "Makeup & Styling", price: 15000 },
        { name: "Reception Makeup", cat: "Makeup & Styling", price: 6000 },
        { name: "Hair Styling / Curls / Bun", cat: "Makeup & Styling", price: 500 },
        { name: "Saree / Dupatta Draping", cat: "Makeup & Styling", price: 300 },
        
        // Hair Treatments & Color
        { name: "Root Touch-Up", cat: "Hair Colour", price: 600 },
        { name: "Global Hair Color", cat: "Hair Colour", price: 1800 },
        { name: "Hair Spa (L'Oreal)", cat: "Hair Spa", price: 599 },
        { name: "Keratin Treatment", cat: "Hair Treatments", price: 2999 },
        { name: "Rebonding / Smoothening", cat: "Hair Treatments", price: 3499 },
        { name: "Botox Hair Treatment", cat: "Hair Treatments", price: 3999 }
      ];

      const selectedMap = {};

      function renderCatalog(items) {
        const list = document.getElementById('catalogList');
        if (!list) return;
        list.innerHTML = '';
        if (items.length === 0) {
          list.innerHTML = '<div style="padding: 10px; color: #94a3b8; text-align: center; font-size: 12px;">Koi service match nahi hui</div>';
          return;
        }
        items.forEach(it => {
          const qty = selectedMap[it.name] || 0;
          const row = document.createElement('div');
          row.style = 'display: flex; justify-content: space-between; align-items: center; padding: 7px 10px; border-bottom: 1px solid #f1f5f9;';
          row.innerHTML = `
            <div>
              <div style="font-weight: 600; font-size: 13px; color: #1e293b;">${it.name}</div>
              <div style="font-size: 11px; color: #64748b;">${it.cat} • Rs. ${it.price}</div>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
              ${qty > 0 ? `<span style="background: #4f46e5; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold;">${qty}</span>` : ''}
              <button type="button" onclick="addService('${it.name}')" style="background: #eef2ff; color: #4f46e5; border: 1px solid #c7d2fe; border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; font-weight: bold;">+ Add</button>
            </div>
          `;
          list.appendChild(row);
        });
      }

      function updateSelectedUI() {
        const box = document.getElementById('selectedServicesContainer');
        const list = document.getElementById('selectedServicesList');
        if (!box || !list) return;
        list.innerHTML = '';
        const keys = Object.keys(selectedMap);
        
        if (keys.length === 0) {
          box.style.display = 'none';
          document.getElementById('service').value = '';
          return;
        }
        
        box.style.display = 'block';
        keys.forEach(k => {
          const qty = selectedMap[k];
          const div = document.createElement('div');
          div.style = 'display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; font-size: 13px;';
          div.innerHTML = `
            <span style="font-weight: 600; color: #0f172a;">${k}</span>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" onclick="removeService('${k}')" style="background: #fee2e2; color: #dc2626; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; font-weight: bold;">-</button>
              <span style="font-weight: bold; color: #4f46e5;">${qty}</span>
              <button type="button" onclick="addService('${k}')" style="background: #e0e7ff; color: #4f46e5; border: none; border-radius: 4px; width: 22px; height: 22px; cursor: pointer; font-weight: bold;">+</button>
            </div>
          `;
          list.appendChild(div);
        });

        document.getElementById('service').value = keys.map(k => selectedMap[k] > 1 ? `${k} x ${selectedMap[k]}` : k).join(', ');
      }

      window.addService = function(name) {
        selectedMap[name] = (selectedMap[name] || 0) + 1;
        updateSelectedUI();
        filterServices();
      };

      window.removeService = function(name) {
        if (selectedMap[name] > 1) {
          selectedMap[name]--;
        } else {
          delete selectedMap[name];
        }
        updateSelectedUI();
        filterServices();
      };

      window.filterServices = function() {
        const q = (document.getElementById('serviceSearch').value || '').toLowerCase().trim();
        const f = salonServices.filter(s => s.name.toLowerCase().includes(q) || s.cat.toLowerCase().includes(q));
        renderCatalog(f);
      };

      setTimeout(() => { renderCatalog(salonServices); }, 100);
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
// Update booking status API (CONFIRMED, CANCELLED)
app.post('/api/booking-status', (req, res) => {
  const { id, status } = req.body;
  const item = bookings.find(b => b.id == id);
  if (item) {
    item.status = status;
    saveBackup();
    return res.json({ success: true, booking: item });
  }
  res.status(404).json({ error: 'Booking not found' });
});
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


