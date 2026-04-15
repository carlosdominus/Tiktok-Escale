import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";
import admin from "firebase-admin";
import { getFirestore } from "firebase-admin/firestore";
import { google } from "googleapis";
import fs from "fs";

// Load config for fallback
const configPath = path.join(process.cwd(), "firebase-applet-config.json");
const appConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};

// Initialize Firebase Admin with absolute certainty
let db: any;
try {
  if (!admin.apps.length) {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    const projectId = appConfig.projectId || "gen-lang-client-0493400479";
    
    if (rawServiceAccount) {
      let serviceAccount;
      try {
        serviceAccount = JSON.parse(rawServiceAccount);
      } catch (e) {
        serviceAccount = JSON.parse(rawServiceAccount.replace(/\\n/g, '\n'));
      }
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id || projectId
      });
      console.log(`Firebase Admin: Initialized with Service Account for project: ${serviceAccount.project_id || projectId}`);
    } else {
      admin.initializeApp({
        projectId: projectId
      });
      console.log(`Firebase Admin: Initialized with Project ID: ${projectId}`);
    }
  }
  
  // Explicitly use the database ID from config
  const databaseId = appConfig.firestoreDatabaseId || "(default)";
  db = getFirestore(admin.app(), databaseId === "(default)" ? undefined : databaseId);
  console.log(`Firestore: Using database: ${databaseId}`);
} catch (error) {
  console.error("CRITICAL_FIREBASE_INIT_ERROR:", error);
}

// Helper for Google Sheets Auth
async function getSheetsClient() {
  try {
    const rawServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawServiceAccount) return null;
    
    let serviceAccount;
    try {
      serviceAccount = JSON.parse(rawServiceAccount);
    } catch (e) {
      serviceAccount = JSON.parse(rawServiceAccount.replace(/\\n/g, '\n'));
    }

    const auth = new google.auth.JWT({
      email: serviceAccount.client_email,
      key: serviceAccount.private_key,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });
    
    return google.sheets({ version: 'v4', auth });
  } catch (error) {
    console.error("SHEETS_AUTH_ERROR:", error);
    return null;
  }
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

// Debug endpoint to check connections
app.get("/api/debug", async (req, res) => {
  const status: any = {
    firebase: "Checking...",
    sheets: "Checking...",
    config: {
      projectId: appConfig.projectId,
      databaseId: appConfig.firestoreDatabaseId,
      adminProjectId: admin.app().options.projectId
    },
    env: {
      hasServiceAccount: !!process.env.FIREBASE_SERVICE_ACCOUNT,
      hasAbacateKey: !!process.env.ABACATE_PAY_API_KEY
    }
  };

  try {
    const salesSnap = await db.collection("sales").orderBy("createdAt", "desc").limit(10).get();
    status.firebase = `OK (${salesSnap.size} recent sales found)`;
    status.recentSales = salesSnap.docs.map((d: any) => ({ 
      id: d.id, 
      status: d.data().status, 
      externalId: d.data().externalId,
      package: d.data().packageId,
      amount: d.data().amount,
      createdAt: d.data().createdAt
    }));

    const logsSnap = await db.collection("webhook_logs").orderBy("timestamp", "desc").limit(5).get();
    status.webhookLogs = logsSnap.docs.map((d: any) => d.data());
  } catch (e: any) {
    status.firebase = `ERROR: ${e.message}`;
  }

  try {
    const sheets = await getSheetsClient();
    if (sheets) {
      const spreadsheet = await sheets.spreadsheets.get({
        spreadsheetId: ACCOUNTS_SHEET_ID,
      });
      const sheetNames = spreadsheet.data.sheets?.map(s => s.properties?.title) || [];
      const resp = await sheets.spreadsheets.values.get({
        spreadsheetId: ACCOUNTS_SHEET_ID,
        range: `'${sheetNames[0]}'!A1:D1`,
      });
      status.sheets = `OK (Sheet: "${sheetNames[0]}", Headers: ${resp.data.values?.[0]?.join(", ")})`;
    } else {
      status.sheets = "ERROR: No service account configured";
    }
  } catch (e: any) {
    status.sheets = `ERROR: ${e.message}`;
  }

  res.send(`
    <html>
      <head>
        <title>DominusScale Debug</title>
        <style>
          body{font-family:sans-serif;padding:20px;line-height:1.5;background:#f8f9fa}
          pre{background:#212529;color:#f8f9fa;padding:15px;border-radius:8px;overflow:auto;max-height:400px}
          .card{background:white;padding:20px;border-radius:8px;box-shadow:0 2px 4px rgba(0,0,0,0.1);margin-bottom:20px}
          button{padding:10px 20px;background:#007bff;color:white;border:none;border-radius:5px;cursor:pointer;font-weight:bold}
          button:hover{background:#0056b3}
          button.danger{background:#dc3545}
          button.danger:hover{background:#a71d2a}
          table{width:100%;border-collapse:collapse;margin-top:10px}
          th,td{padding:12px;text-align:left;border-bottom:1px solid #dee2e6}
          th{background:#f1f3f5}
          .status-paid{color:#28a745;font-weight:bold}
          .status-pending{color:#ffc107;font-weight:bold}
        </style>
      </head>
      <body>
        <h1>DominusScale Debug Panel</h1>
        
        <div class="card">
          <h2>Configuração de Webhook</h2>
          <p>Para que o pagamento seja automático, você <b>precisa</b> configurar esta URL no painel da Abacate Pay:</p>
          <pre style="background:#e9ecef;color:#495057;border:1px solid #ced4da">https://tiktok-escale.vercel.app/api/webhook/abacatepay</pre>
          <p><small>⚠️ Se esta URL não estiver lá, o site nunca saberá que o PIX foi pago sozinho.</small></p>
        </div>

        <div class="card">
          <h2>Status do Sistema</h2>
          <pre>${JSON.stringify({ firebase: status.firebase, sheets: status.sheets, config: status.config, env: status.env }, null, 2)}</pre>
        </div>

        <div class="card">
          <h2>Ações Globais</h2>
          <button onclick="sync()">Sincronizar com Abacate Pay (Auto)</button>
          <button onclick="simulateWebhook()" style="background:#6c757d;margin-left:10px">Simular Recebimento de Webhook (Teste)</button>
          <div id="sync-result" style="margin-top:10px;white-space:pre-wrap;font-size:0.9em"></div>
        </div>

        <div class="card">
          <h2>Vendas Recentes</h2>
          <table>
            <thead>
              <tr>
                <th>ID Interno</th>
                <th>Data</th>
                <th>Pacote</th>
                <th>Valor</th>
                <th>Status</th>
                <th>ID Abacate</th>
                <th>Ações</th>
              </tr>
            </thead>
            <tbody>
              ${status.recentSales?.map((s: any) => `
                <tr>
                  <td>${s.id}</td>
                  <td>${new Date(s.createdAt).toLocaleString()}</td>
                  <td>${s.package}</td>
                  <td>R$ ${s.amount}</td>
                  <td class="status-${s.status}">${s.status.toUpperCase()}</td>
                  <td><code>${s.externalId}</code></td>
                  <td>
                    ${s.status === 'pending' ? `<button class="danger" onclick="forceApprove('${s.id}')">Aprovar Manual</button>` : '-'}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>

        <div class="card">
          <h2>Últimos Webhooks Recebidos</h2>
          <pre>${JSON.stringify(status.webhookLogs, null, 2)}</pre>
        </div>

        <script>
          async function simulateWebhook() {
            const resDiv = document.getElementById('sync-result');
            resDiv.innerText = 'Simulando webhook...';
            try {
              // Get the last pending sale ID to simulate
              const rows = document.querySelectorAll('tr');
              let lastPending = null;
              for(const row of rows) {
                if(row.innerText.includes('PENDING')) {
                  lastPending = row.querySelector('td').innerText;
                  break;
                }
              }

              if(!lastPending) {
                alert('Nenhum pedido PENDENTE encontrado para testar.');
                return;
              }

              const resp = await fetch('/api/webhook/abacatepay', { 
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                  event: 'billing.paid',
                  data: {
                    id: 'simulated_id_' + Date.now(),
                    metadata: { saleId: lastPending }
                  }
                })
              });
              resDiv.innerText = 'Simulação enviada! Status: ' + resp.status;
              setTimeout(() => location.reload(), 2000);
            } catch (e) {
              resDiv.innerText = 'Erro na simulação: ' + e.message;
            }
          }

          async function sync() {
            const resDiv = document.getElementById('sync-result');
            resDiv.innerText = 'Sincronizando...';
            try {
              const resp = await fetch('/api/sync-orders', { method: 'POST' });
              const data = await resp.json();
              resDiv.innerText = JSON.stringify(data, null, 2);
              setTimeout(() => location.reload(), 3000);
            } catch (e) {
              resDiv.innerText = 'Erro: ' + e.message;
            }
          }

          async function forceApprove(id) {
            if(!confirm('Tem certeza que deseja aprovar este pedido manualmente?')) return;
            try {
              const resp = await fetch('/api/force-approve', { 
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ saleId: id })
              });
              const data = await resp.json();
              alert(data.message || data.error);
              location.reload();
            } catch (e) {
              alert('Erro: ' + e.message);
            }
          }
        </script>
      </body>
    </html>
  `);
});

// Force approve endpoint with delivery
app.post("/api/force-approve", async (req, res) => {
  const { saleId } = req.body;
  if (!saleId) return res.status(400).json({ error: "Missing saleId" });

  try {
    const saleRef = db.collection("sales").doc(saleId);
    const snap = await saleRef.get();
    if (!snap.exists) return res.status(404).json({ error: "Sale not found" });
    
    const saleData = snap.data();
    if (saleData.status === "paid") return res.json({ message: "Este pedido já está pago." });

    let accountsText = "Aprovado manualmente. Contas entregues via painel.";
    
    // Try to deliver accounts from sheet
    try {
      const sheets = await getSheetsClient();
      if (sheets) {
        const sheetResponse = await sheets.spreadsheets.values.get({
          spreadsheetId: ACCOUNTS_SHEET_ID,
          range: "'BCs'!A:D",
        });

        const rows = sheetResponse.data.values || [];
        const headers = rows[0] || [];
        const emailIdx = headers.indexOf("Email outlook");
        const statusIdx = headers.indexOf("Status");
        const senhaIdx = headers.indexOf("Senha");

        if (emailIdx !== -1 && statusIdx !== -1) {
          let countToDeliver = 1;
          const pkgId = saleData.packageId || "";
          if (pkgId.includes("Pacote 1")) countToDeliver = 1;
          else if (pkgId.includes("Pacote 2")) countToDeliver = 3;
          else if (pkgId.includes("Pacote 3")) {
            const match = pkgId.match(/\d+/);
            if (match) countToDeliver = parseInt(match[0]);
          }

          const selectedRows = [];
          for (let i = 1; i < rows.length; i++) {
            if (selectedRows.length >= countToDeliver) break;
            const row = rows[i];
            if (row[statusIdx]?.trim().toLowerCase() === "à venda") {
              selectedRows.push({ index: i + 1, User: row[emailIdx], Senha: row[senhaIdx] || "N/A" });
            }
          }

          if (selectedRows.length > 0) {
            for (const row of selectedRows) {
              await sheets.spreadsheets.values.update({
                spreadsheetId: ACCOUNTS_SHEET_ID,
                range: `'BCs'!D${row.index}`,
                valueInputOption: 'RAW',
                requestBody: { values: [["vendida"]] }
              });
            }
            accountsText = selectedRows.map(r => `User: ${r.User} | Senha: ${r.Senha}`).join("\n");
          }
        }
      }
    } catch (sheetErr: any) {
      console.error("Manual Approval Sheet Error:", sheetErr.message);
      accountsText = "Aprovado! (Erro na planilha: Entrega manual necessária)";
    }

    await saleRef.update({
      status: "paid",
      paidAt: new Date().toISOString(),
      accounts: accountsText
    });

    res.json({ message: "Pedido aprovado e contas selecionadas!", accounts: accountsText });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Manual sync endpoint - More aggressive
app.post("/api/sync-orders", async (req, res) => {
  const results: any[] = [];
  const apiKey = process.env.ABACATE_PAY_API_KEY;

  if (!apiKey) return res.status(500).json({ error: "ABACATE_PAY_API_KEY not configured" });

  try {
    const response = await axios.get("https://api.abacatepay.com/v1/billing/list", {
      headers: { "Authorization": `Bearer ${apiKey}` }
    });

    const billings = response.data.data || [];
    const pendingSales = await db.collection("sales").where("status", "==", "pending").get();
    
    for (const doc of pendingSales.docs) {
      const saleData = doc.data();
      const extId = saleData.externalId;

      // Try to find by ANY possible ID match
      const match = billings.find((b: any) => {
        const idMatch = b.id === extId;
        const pixIdMatch = b.pix && b.pix.id === extId;
        const metaMatch = b.metadata && b.metadata.saleId === doc.id;
        // Also check if the amount and customer email match as a last resort
        const emailMatch = b.customer?.email === saleData.customer?.email;
        const amountMatch = Math.abs(b.amount - (saleData.amount * 100)) < 10;
        
        return idMatch || pixIdMatch || metaMatch || (emailMatch && amountMatch);
      });
      
      if (match && (match.status === "PAID" || match.status === "CONFIRMED")) {
        // Use the force-approve logic internally
        await axios.post(`${req.protocol}://${req.get('host')}/api/force-approve`, { saleId: doc.id });
        results.push({ id: doc.id, status: "UPDATED_TO_PAID" });
      } else {
        results.push({ id: doc.id, status: match ? match.status : "NOT_FOUND" });
      }
    }
    res.json({ message: "Sync complete", results });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// API to fetch accounts from Sheet 1
app.get("/api/accounts", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("BCs");
    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
    });
    
    // Normalize keys to match frontend expectations
    const normalized = records.map((r: any) => ({
      User: r["Email outlook"] || r["User"],
      Senha: r["Senha"],
      Seguidores: r["Seguidores"] || "0",
      Curtidas: r["Curtidas"] || "0",
      Status: r["Status"]
    }));
    
    res.json(normalized);
  } catch (error: any) {
    console.error("Error fetching accounts:", error.message);
    res.status(500).json({ error: "Failed to fetch accounts", details: error.message });
  }
});

// API to fetch packages from the NEW Plans Sheet
app.get("/api/packages", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("Página2");
    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${PLANS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const records = parse(response.data, {
      columns: false,
      skip_empty_lines: true,
    });
    
    if (!Array.isArray(records) || records.length === 0) {
      return res.json([]);
    }

    const packages = [];
    const headers = records[0] || [];
    for (let i = 1; i < headers.length; i++) {
      if (!headers[i]) continue;
      packages.push({
        name: headers[i],
        profiles: records[1] && records[1][i] ? String(records[1][i]) : "0",
        accounts: records[2] && records[2][i] ? String(records[2][i]) : "0",
        price: records[3] && records[3][i] ? String(records[3][i]) : "0",
      });
    }
    
    res.json(packages);
  } catch (error: any) {
    console.error("Error fetching packages:", error.message);
    res.status(500).json({ error: "Failed to fetch packages", details: error.message });
  }
});

// Abacate Pay PIX generation
app.post("/api/pix/generate", async (req, res) => {
  const { amount, packageId, customer, userId } = req.body;
  
  if (!amount || !packageId || !customer || !userId) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const numericAmount = parseFloat(String(amount));
  const apiKey = process.env.ABACATE_PAY_API_KEY;

  if (!apiKey) {
    console.error("CRITICAL: ABACATE_PAY_API_KEY is missing in environment variables.");
    return res.status(500).json({ 
      error: "Configuração do Servidor Incompleta", 
      details: "A chave de API da Abacate Pay não foi configurada. Por favor, adicione ABACATE_PAY_API_KEY às variáveis de ambiente da Vercel e faça um novo deploy." 
    });
  }

  try {
    const numericAmountCents = Math.round(numericAmount * 100);
    
    // Create a pending sale in Firestore first
    let saleRef;
    try {
      saleRef = db.collection("sales").doc();
    } catch (fsError: any) {
      console.error("FIRESTORE_INIT_ERROR:", fsError.message);
      return res.status(500).json({ error: "Erro ao acessar banco de dados", details: fsError.message });
    }
    const saleId = saleRef.id;

    // Using pixQrCode/create for direct PIX
    const pixData = {
      amount: numericAmountCents,
      expiresIn: 3600,
      description: `DominusScale - ${packageId}`.substring(0, 140),
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        cellphone: String(customer.phone).replace(/\D/g, ""),
        taxId: String(customer.taxId).replace(/\D/g, ""),
      },
      // Pass our internal saleId as metadata so we can identify it in the webhook
      metadata: {
        saleId: saleId,
        userId: userId,
        packageId: packageId
      }
    };

    console.log("ABACATE_PAY_DEBUG: Generating PIX for sale:", saleId);

    const response = await axios.post("https://api.abacatepay.com/v1/pixQrCode/create", pixData, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      timeout: 15000
    });

    const apiResponse = response.data;
    const data = apiResponse.data;
    
    if (!data || !data.brCode) {
      throw new Error("A API da Abacate Pay não retornou um código PIX válido.");
    }

    // Save the pending sale to Firestore
    await saleRef.set({
      userId,
      packageId,
      amount: numericAmount,
      status: "pending",
      pixCode: data.brCode,
      externalId: data.id,
      createdAt: new Date().toISOString(),
      customer: {
        name: customer.name,
        email: customer.email
      }
    });

    res.json({
      pixCode: data.brCode,
      qrCode: data.brCodeBase64,
      txId: data.id,
      saleId: saleId,
      isMock: false
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error("ABACATE_PAY_API_ERROR:", JSON.stringify(errorData, null, 2) || error.message);
    res.status(error.response?.status || 500).json({ 
      error: "Erro na Abacate Pay",
      details: errorData?.error || errorData?.message || error.message
    });
  }
});

// Webhook for Abacate Pay
app.post("/api/webhook/abacatepay", async (req, res) => {
  const event = req.body;
  
  // Log webhook to Firestore for debugging
  try {
    await db.collection("webhook_logs").add({
      timestamp: new Date().toISOString(),
      event: event.event,
      payload: event
    });
  } catch (logErr) {
    console.error("Failed to log webhook:", logErr);
  }

  console.log("WEBHOOK_RECEIVED:", JSON.stringify(event, null, 2));

  const isPaid = event.event === "billing.paid" || event.event === "pix.paid" || event.event === "billing.confirmed";
  
  if (isPaid) {
    const billingData = event.data || {};
    
    // Abacate Pay can nest metadata inside pixQrCode or billing
    const saleIdFromMetadata = billingData.metadata?.saleId || 
                               billingData.pixQrCode?.metadata?.saleId ||
                               billingData.billing?.metadata?.saleId;
                               
    const externalId = billingData.id || billingData.pixQrCode?.id || billingData.billing?.id;
    const pixId = billingData.pix?.id || billingData.pixQrCode?.id;

    console.log(`WEBHOOK_LOOKUP: saleId=${saleIdFromMetadata}, extId=${externalId}, pixId=${pixId}`);

    try {
      let saleRef;
      let saleData;

      // 1. Try by metadata saleId
      if (saleIdFromMetadata) {
        console.log(`Trying lookup by metadata saleId: ${saleIdFromMetadata}`);
        const docRef = db.collection("sales").doc(saleIdFromMetadata);
        const snap = await docRef.get();
        if (snap.exists) {
          saleRef = docRef;
          saleData = snap.data();
        }
      }

      // 2. Try by externalId (billing ID)
      if (!saleData && externalId) {
        console.log(`Trying lookup by externalId: ${externalId}`);
        const q = await db.collection("sales").where("externalId", "==", externalId).limit(1).get();
        if (!q.empty) {
          saleRef = q.docs[0].ref;
          saleData = q.docs[0].data();
        }
      }

      // 3. Try by pixId
      if (!saleData && pixId) {
        console.log(`Trying lookup by pixId: ${pixId}`);
        const q = await db.collection("sales").where("externalId", "==", pixId).limit(1).get();
        if (!q.empty) {
          saleRef = q.docs[0].ref;
          saleData = q.docs[0].data();
        }
      }

      if (saleRef && saleData && saleData.status !== "paid") {
        console.log(`MATCH_FOUND: Processing payment for Sale ${saleRef.id}`);
        
        let accountsText = "Pagamento confirmado! Suas contas estão sendo preparadas.";
        
        try {
          const sheets = await getSheetsClient();
          if (sheets) {
            const sheetResponse = await sheets.spreadsheets.values.get({
              spreadsheetId: ACCOUNTS_SHEET_ID,
              range: "'BCs'!A:D",
            });

            const rows = sheetResponse.data.values || [];
            const headers = rows[0] || [];
            const emailIdx = headers.indexOf("Email outlook");
            const statusIdx = headers.indexOf("Status");
            const senhaIdx = headers.indexOf("Senha");

            if (emailIdx !== -1 && statusIdx !== -1) {
              let countToDeliver = 1;
              const pkgId = saleData.packageId || "";
              if (pkgId.includes("Pacote 1")) countToDeliver = 1;
              else if (pkgId.includes("Pacote 2")) countToDeliver = 3;
              else if (pkgId.includes("Pacote 3")) {
                const match = pkgId.match(/\d+/);
                if (match) countToDeliver = parseInt(match[0]);
              }

              const selectedRows = [];
              for (let i = 1; i < rows.length; i++) {
                if (selectedRows.length >= countToDeliver) break;
                const row = rows[i];
                if (row[statusIdx]?.trim().toLowerCase() === "à venda") {
                  selectedRows.push({ index: i + 1, User: row[emailIdx], Senha: row[senhaIdx] || "N/A" });
                }
              }

              if (selectedRows.length > 0) {
                for (const row of selectedRows) {
                  await sheets.spreadsheets.values.update({
                    spreadsheetId: ACCOUNTS_SHEET_ID,
                    range: `'BCs'!D${row.index}`,
                    valueInputOption: 'RAW',
                    requestBody: { values: [["vendida"]] }
                  });
                }
                accountsText = selectedRows.map(r => `User: ${r.User} | Senha: ${r.Senha}`).join("\n");
              }
            }
          }
        } catch (sheetErr: any) {
          console.error("SHEET_ERROR_BUT_CONFIRMING_SALE:", sheetErr.message);
        }

        await saleRef.update({
          status: "paid",
          paidAt: new Date().toISOString(),
          accounts: accountsText
        });
        console.log(`SALE_CONFIRMED: ${saleRef.id}`);
      } else {
        console.log("NO_MATCH_OR_ALREADY_PAID:", { saleIdFromMetadata, externalId, pixId });
      }
    } catch (error: any) {
      console.error("WEBHOOK_FATAL_ERROR:", error.message);
    }
  }
  res.sendStatus(200);
});

// SPA Handling
if (process.env.NODE_ENV === "production" || process.env.VERCEL) {
  const distPath = path.join(process.cwd(), "dist");
  app.use(express.static(distPath));
  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

export default app;

async function startServer() {
  const PORT = 3000;
  
  if (process.env.NODE_ENV !== "production" && !process.env.VERCEL) {
    const { createServer } = await import("vite");
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  }
}

startServer();
