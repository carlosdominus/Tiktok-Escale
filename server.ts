import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

// API to fetch accounts from Sheet 1
app.get("/api/accounts", async (req, res) => {
  try {
    const sheetName = encodeURIComponent("Página1");
    const response = await axios.get(
      `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=${sheetName}`
    );
    const records = parse(response.data, {
      columns: true,
      skip_empty_lines: true,
    });
    res.json(records);
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
  const { amount, packageId, customer } = req.body;
  
  if (!amount || !packageId || !customer) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const numericAmount = parseFloat(String(amount));
  const apiKey = process.env.ABACATE_PAY_API_KEY;

  if (!apiKey) {
    const txId = Math.random().toString(36).substring(7).toUpperCase();
    const pixCode = `00020126580014BR.GOV.BCB.PIX0118carlos@dominus.site520400005303986540${numericAmount.toFixed(2)}5802BR5913CARLOS DOMINUS6008BRASILIA62070503${txId}6304ABCD`;
    return res.json({ pixCode, txId, isMock: true });
  }

  try {
    const numericAmountCents = Math.round(numericAmount * 100);
    
    // Using billing/create - The most stable way for Production
    const billingData = {
      frequency: "ONE_TIME",
      methods: ["PIX"],
      products: [
        {
          externalId: String(packageId).substring(0, 50),
          name: String(packageId).substring(0, 100),
          quantity: 1,
          unitPrice: Number(numericAmountCents),
        },
      ],
      returnUrl: "https://tiktok-escale.vercel.app",
      completionUrl: "https://tiktok-escale.vercel.app/success",
      customer: {
        name: String(customer.name).trim(),
        email: String(customer.email).trim(),
        cellphone: String(customer.phone).replace(/\D/g, ""),
        taxId: String(customer.taxId).replace(/\D/g, ""),
      },
    };

    console.log("ABACATE_PAY_DEBUG: Requesting Billing:", JSON.stringify(billingData, null, 2));

    const response = await axios.post("https://api.abacatepay.com/v1/billing/create", billingData, {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
      }
    });

    console.log("ABACATE_PAY_DEBUG: Full Response:", JSON.stringify(response.data, null, 2));

    const data = response.data.data;
    
    if (!data || !data.url) {
      throw new Error("A API da Abacate Pay não retornou uma URL de checkout.");
    }

    res.json({
      pixCode: data.url, // This is the checkout URL
      checkoutUrl: data.url,
      txId: data.id,
      isMock: false
    });
  } catch (error: any) {
    const errorData = error.response?.data;
    console.error("ABACATE_PAY_CRITICAL_ERROR:", JSON.stringify(errorData, null, 2) || error.message);
    
    res.status(error.response?.status || 500).json({ 
      error: "Erro na Abacate Pay",
      details: errorData?.error || errorData?.message || error.message,
      dev_note: "Verifique se sua conta Abacate Pay está ativa para produção e se o CPF/CNPJ é válido."
    });
  }
});

// Webhook for Abacate Pay
app.post("/api/webhook/abacatepay", async (req, res) => {
  const event = req.body;
  if (event.event === "billing.paid" || event.event === "pix.paid") {
    console.log(`Payment confirmed for billing ${event.data.id}`);
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
