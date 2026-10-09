const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(cors());
app.use(express.json());

// In-memory + Local file backup for Cloud resiliency
const billsCache = new Map();
const backupFile = path.join(__dirname, 'cloud_bills.json');

if (fs.existsSync(backupFile)) {
  try {
    const raw = fs.readFileSync(backupFile, 'utf8');
    const parsed = JSON.parse(raw);
    Object.keys(parsed).forEach(k => billsCache.set(k, parsed[k]));
  } catch (e) {}
}

function saveBackup() {
  try {
    const obj = {};
    billsCache.forEach((v, k) => { obj[k] = v; });
    fs.writeFileSync(backupFile, JSON.stringify(obj, null, 2));
  } catch (e) {}
}

// Database optional setup
let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
  pool.query(`
    CREATE TABLE IF NOT EXISTS invoices (
      id SERIAL PRIMARY KEY,
      invoice_number VARCHAR(50) UNIQUE,
      customer_name VARCHAR(100),
      customer_phone VARCHAR(20),
      subtotal NUMERIC,
      discount NUMERIC,
      grand_total NUMERIC,
      payment_mode VARCHAR(20),
      items JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `).catch(() => {});
}

// Save Bill API
app.post('/api/save-bill', async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      subtotal,
      discountAmount,
      discount,
      grandTotal,
      paymentMode,
      invoiceNumber,
      items
    } = req.body;

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

    if (pool) {
      try {
        await pool.query(
          `INSERT INTO invoices (invoice_number, customer_name, customer_phone, subtotal, discount, grand_total, payment_mode, items)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (invoice_number) DO NOTHING`,
          [invNo, billData.customerName, billData.customerPhone, billData.subtotal, billData.discount, billData.grandTotal, billData.paymentMode, JSON.stringify(billData.items)]
        );
      } catch (err) {}
    }

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

// Web Invoice HTML View (Stylist completely hidden from client)
app.get('/invoice/:id', async (req, res) => {
  const invId = req.params.id;
  let bill = billsCache.get(invId);

  if (!bill && pool) {
    try {
      const q = await pool.query('SELECT * FROM invoices WHERE invoice_number = $1', [invId]);
      if (q.rows.length > 0) {
        const r = q.rows[0];
        bill = {
          invoiceNumber: r.invoice_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          subtotal: Number(r.subtotal),
          discount: Number(r.discount),
          grandTotal: Number(r.grand_total),
          paymentMode: r.payment_mode,
          items: r.items,
          date: new Date(r.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
        };
      }
    } catch (e) {}
  }

  if (!bill) {
    return res.status(404).send(`
      <div style="font-family:sans-serif; text-align:center; padding:50px;">
        <h2>Invoice Not Found</h2>
        <p>Yeh bill server par generate nahi ho paya ya delete ho gaya hai.</p>
      </div>
    `);
  }

  const itemsHtml = bill.items.map(it => `
    <tr style="border-bottom: 1px solid #e2e8f0;">
      <td style="padding: 10px 8px; font-weight: 500;">${it.name || it.item_name || 'Service'}</td>
      <td style="padding: 10px 8px; text-align: center;">${it.qty || 1}</td>
      <td style="padding: 10px 8px; text-align: right;">Rs. ${Number(it.price || 0).toFixed(0)}</td>
      <td style="padding: 10px 8px; text-align: right; font-weight: 600;">Rs. ${(Number(it.price || 0) * (it.qty || 1)).toFixed(0)}</td>
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
    .header h2 { margin: 0; color: #0F766E; font-size: 20px; letter-spacing: 0.5px; }
    .header p { margin: 4px 0; color: #64748b; font-size: 11px; }
    .meta { display: flex; justify-content: space-between; font-size: 12px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; background: #f8fafc; padding: 8px; color: #475569; font-size: 11px; text-transform: uppercase; }
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
      <div>
        <strong>Invoice: #${bill.invoiceNumber}</strong><br>
        <span>Date: ${bill.date}</span>
      </div>
      <div style="text-align: right;">
        <strong>Customer: ${bill.customerName}</strong><br>
        <span>Phone: ${bill.customerPhone}</span>
      </div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Service / Product</th>
          <th style="text-align: center;">Qty</th>
          <th style="text-align: right;">Price</th>
          <th style="text-align: right;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsHtml}
      </tbody>
    </table>
    <div class="total-box">
      <div class="total-row"><span>Subtotal:</span><span>Rs. ${bill.subtotal.toFixed(2)}</span></div>
      ${bill.discount > 0 ? `<div class="total-row" style="color: #ef4444;"><span>Discount:</span><span>- Rs. ${bill.discount.toFixed(2)}</span></div>` : ''}
      <div class="total-row grand"><span>Total Paid:</span><span>Rs. ${bill.grandTotal.toFixed(2)}</span></div>
    </div>
    <div class="footer">
      <p>🌸 Thank you for visiting! We look forward to seeing you again. ✨</p>
    </div>
  </div>
</body>
</html>
  `);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend server running on port ${PORT}`);
});
