import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import { parse } from "csv-parse/sync";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const PLANS_SHEET_ID = "1fbtsbZOhGR7plw7kRDL3on4v4-MvkXXmKX-k_2pQN1w";
  const ACCOUNTS_SHEET_ID = "1YsqLgZzHPjj_LP9NwYxTeE5X8E0El4Lnu5S5KpMJG2E";

  // API to fetch accounts from Sheet 1
  app.get("/api/accounts", async (req, res) => {
    try {
      const response = await axios.get(
        `https://docs.google.com/spreadsheets/d/${ACCOUNTS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Página1`
      );
      const records = parse(response.data, {
        columns: true,
        skip_empty_lines: true,
      });
      res.json(records);
    } catch (error) {
      console.error("Error fetching accounts:", error);
      res.status(500).json({ error: "Failed to fetch accounts" });
    }
  });

  // API to fetch packages from the NEW Plans Sheet
  app.get("/api/packages", async (req, res) => {
    try {
      const response = await axios.get(
        `https://docs.google.com/spreadsheets/d/${PLANS_SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Página2`
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
    } catch (error) {
      console.error("Error fetching packages:", error);
      res.status(500).json({ error: "Failed to fetch packages" });
    }
  });

  // Abacate Pay PIX generation
  app.post("/api/pix/generate", async (req, res) => {
    const { amount, packageId, customerEmail } = req.body;
    
    console.log("PIX Request received:", { amount, packageId, customerEmail });

    if (!amount || !packageId || !customerEmail) {
      return res.status(400).json({ error: "Missing required fields: amount, packageId, or customerEmail" });
    }

    // Ensure amount is a valid number
    const numericAmount = parseFloat(String(amount));
    if (isNaN(numericAmount) || numericAmount <= 0) {
      console.error("Invalid amount received:", amount);
      return res.status(400).json({ error: "Invalid amount" });
    }

    const apiKey = process.env.ABACATE_PAY_API_KEY;

    if (!apiKey) {
      // Fallback to mock if API key is missing
      const txId = Math.random().toString(36).substring(7).toUpperCase();
      const pixCode = `00020126580014BR.GOV.BCB.PIX0118carlos@dominus.site520400005303986540${numericAmount.toFixed(2)}5802BR5913CARLOS DOMINUS6008BRASILIA62070503${txId}6304ABCD`;
      return res.json({ pixCode, txId, isMock: true });
    }

    try {
      const numericAmountCents = Math.round(numericAmount * 100);
      
      const billingData = {
        frequency: "ONE_TIME",
        methods: ["PIX", "CARD"],
        products: [{
          externalId: String(packageId),
          name: `Pacote: ${packageId}`,
          quantity: 1,
          price: numericAmountCents, // Changed from priceUnit to price
        }],
        returnUrl: `${process.env.APP_URL || "http://localhost:3000"}/success?packageId=${packageId}`,
        completionUrl: `${process.env.APP_URL || "http://localhost:3000"}/success?packageId=${packageId}`,
        customer: {
          email: customerEmail,
          name: customerEmail.split("@")[0],
        },
      };

      console.log("Sending to Abacate Pay:", JSON.stringify(billingData, null, 2));

      const response = await axios.post("https://api.abacatepay.com/v1/billing/create", billingData, {
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      });

      // Abacate Pay billing/create returns a checkout URL
      const billing = response.data.data;
      res.json({
        pixCode: billing.url, // Use the checkout URL
        txId: billing.id,
        isMock: false
      });
    } catch (error: any) {
      const errorData = error.response?.data;
      console.error("Abacate Pay Error:", errorData || error.message);
      res.status(error.response?.status || 500).json({ 
        error: "Failed to generate PIX via Abacate Pay",
        details: errorData
      });
    }
  });

  // Webhook for Abacate Pay
  app.post("/api/webhook/abacatepay", express.json(), async (req, res) => {
    const event = req.body;
    console.log("Webhook received from Abacate Pay:", JSON.stringify(event, null, 2));

    // Event types: billing.paid, pix.paid, etc.
    if (event.event === "billing.paid" || event.event === "pix.paid") {
      const billingId = event.data.id;
      const customerEmail = event.data.customer?.email;
      
      console.log(`Payment confirmed for billing ${billingId}, customer ${customerEmail}`);
      
      // Here you would trigger the account delivery logic
      // e.g., update Firestore or send an email
    }

    res.sendStatus(200);
  });

  // Serve the success page for all routes that aren't API
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
