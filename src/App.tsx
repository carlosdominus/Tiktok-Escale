import { useState, useEffect, useMemo, ReactNode, useRef, FormEvent } from "react";
import { motion, AnimatePresence, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import axios from "axios";
import { 
  ShoppingCart, 
  ShieldCheck, 
  Zap, 
  CheckCircle2, 
  Copy, 
  QrCode, 
  ArrowRight,
  Package,
  Users,
  CreditCard,
  ExternalLink,
  LogOut,
  User as UserIcon,
  ShoppingBag,
  ArrowLeft,
  Download,
  Check,
  PlayCircle,
  TrendingUp,
  LayoutDashboard,
  Clock,
  Info
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast, Toaster } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import QRCode from "qrcode";
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, updateProfile, db, doc, setDoc, getDoc, updateDoc, collection, query, where, onSnapshot, orderBy } from "./firebase";
import { User } from "firebase/auth";

interface PackageData {
  name: string;
  profiles: string;
  accounts: string;
  price: string;
}

interface AccountData {
  "Email outlook": string;
  "Senha": string;
  "Senha tiktok": string;
  "Status": string;
}

const InfoTooltip = ({ content, title }: { content: ReactNode, title?: string }) => {
  const [isOpen, setIsOpen] = useState(false);
  const timeoutRef = useRef<any>(null);

  const handleEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsOpen(true);
  };

  const handleLeave = () => {
    timeoutRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  return (
    <div 
      className="relative inline-block"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <button className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center text-white/30 hover:text-tiktok-cyan transition-all">
        <Info className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            className="absolute z-50 bottom-full right-0 mb-4 w-64 bg-black/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-5 shadow-[0_0_40px_rgba(0,0,0,0.5)] pointer-events-auto"
            onMouseEnter={handleEnter}
            onMouseLeave={handleLeave}
          >
            {/* Bridge element to prevent closing when moving mouse to tooltip */}
            <div className="absolute top-full left-0 w-full h-[30px] bg-transparent" />
            
            {title && <p className="text-[10px] font-black italic tracking-tighter uppercase text-tiktok-cyan mb-2">{title}</p>}
            <div className="text-[11px] text-white/60 font-medium leading-relaxed">
              {content}
            </div>
            <div className="absolute top-full right-4 w-3 h-3 bg-black/95 border-r border-b border-white/10 rotate-45 -mt-[6px]" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default function App() {
  const [packages, setPackages] = useState<PackageData[]>([]);
  const [accounts, setAccounts] = useState<AccountData[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPackage, setSelectedPackage] = useState<PackageData | null>(null);
  const [pixData, setPixData] = useState<{ pixCode: string; qrCode: string; isUrl?: boolean } | null>(null);
  const [isPixModalOpen, setIsPixModalOpen] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [view, setView] = useState<"home" | "orders">("home");
  const [orders, setOrders] = useState<any[]>([]);
  const [isSuccessPage, setIsSuccessPage] = useState(window.location.pathname === "/success");
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [customerData, setCustomerData] = useState({
    name: "",
    email: "",
    phone: "",
    taxId: ""
  });
  const [isGenerating, setIsGenerating] = useState(false);
  const [quantity, setQuantity] = useState(5);
  const [headlineWordIndex, setHeadlineWordIndex] = useState(0);
  
  const headlineWords = ["SEM LIMITES", "SEU ARSENAL", "EM ALTA ESCALA", "INDUSTRIAL"];
  
  const { scrollY } = useScroll();

  useEffect(() => {
    const interval = setInterval(() => {
      setHeadlineWordIndex((prev) => (prev + 1) % headlineWords.length);
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const navigateTo = (id: string) => {
    if (view !== "home") setView("home");
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  };

  const headerHeight = useTransform(scrollY, [0, 100], ["80px", "64px"]);
  const headerPadding = useTransform(scrollY, [0, 100], ["24px", "12px"]);
  const headerBg = useTransform(scrollY, [0, 100], ["rgba(255,255,255,0.03)", "rgba(0,0,0,0.8)"]);
  const headerBorder = useTransform(scrollY, [0, 100], ["rgba(255,255,255,0.12)", "rgba(255,255,255,0.1)"]);
  const headerScale = useTransform(scrollY, [0, 100], [1, 0.96]);

  useEffect(() => {
    if (user) {
      const q = query(
        collection(db, "sales"),
        where("userId", "==", user.uid),
        orderBy("createdAt", "desc")
      );
      
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const ordersData = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setOrders(ordersData);
      });
      
      return () => unsubscribe();
    }
  }, [user]);

  // Auto-close PIX modal when payment is confirmed
  useEffect(() => {
    if (isPixModalOpen && pixData) {
      // Find the order that matches the current PIX session
      // We can match by externalId (txId) or by looking for the most recent paid order
      const paidOrder = orders.find(o => 
        (o.externalId === pixData.txId || o.pixId === pixData.txId) && 
        o.status === "paid"
      );

      if (paidOrder) {
        setIsPixModalOpen(false);
        setIsSuccessPage(true);
        toast.success("Pagamento confirmado! Suas contas foram liberadas.");
      }
    }
  }, [orders, isPixModalOpen, pixData]);

  useEffect(() => {
    const handleLocationChange = () => {
      setIsSuccessPage(window.location.pathname === "/success");
    };
    window.addEventListener("popstate", handleLocationChange);
    return () => window.removeEventListener("popstate", handleLocationChange);
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setIsAuthLoading(false);
      
      if (currentUser) {
        // Sync user to Firestore
        const userRef = doc(db, "users", currentUser.uid);
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          await setDoc(userRef, {
            uid: currentUser.uid,
            email: currentUser.email,
            displayName: currentUser.displayName,
            photoURL: currentUser.photoURL,
            role: "user",
            createdAt: new Date().toISOString()
          });
          setCustomerData(prev => ({
            ...prev,
            name: currentUser.displayName || "",
            email: currentUser.email || ""
          }));
        } else {
          const data = userSnap.data();
          setCustomerData({
            name: data.customerName || data.displayName || currentUser.displayName || "",
            email: data.customerEmail || data.email || currentUser.email || "",
            phone: data.customerPhone || "",
            taxId: data.customerTaxId || ""
          });
        }
      }
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const loadInitialData = async () => {
      try {
        const [pkgRes, accRes] = await Promise.all([
          axios.get("/api/packages"),
          axios.get("/api/accounts")
        ]);
        setPackages(Array.isArray(pkgRes.data) ? pkgRes.data : []);
        const allAccounts = Array.isArray(accRes.data) ? accRes.data : [];
        setAccounts(allAccounts.filter((acc: any) => acc.Status === "à venda"));
      } catch (error) {
        console.error("Error fetching data:", error);
        toast.error("Erro ao carregar informações. Tente novamente.");
      } finally {
        setLoading(false);
      }
    };
    loadInitialData();
  }, []);

  const handleLogin = async () => {
    setIsAuthModalOpen(true);
  };

  const handleGoogleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      toast.success("Login realizado com sucesso!");
      setIsAuthModalOpen(false);
    } catch (error: any) {
      console.error("Login error:", error);
      toast.error("Erro ao fazer login com Google.");
    }
  };

  const handleEmailAuth = async (e: FormEvent) => {
    e.preventDefault();
    if (!authEmail || !authPassword) {
      toast.error("Preencha todos os campos.");
      return;
    }

    try {
      if (authMode === "login") {
        await signInWithEmailAndPassword(auth, authEmail, authPassword);
        toast.success("Bem-vindo de volta!");
      } else {
        if (!authName) {
          toast.error("Informe seu nome.");
          return;
        }
        const userCredential = await createUserWithEmailAndPassword(auth, authEmail, authPassword);
        await updateProfile(userCredential.user, { displayName: authName });
        toast.success("Conta criada com sucesso!");
      }
      setIsAuthModalOpen(false);
      setAuthPassword("");
    } catch (error: any) {
      console.error("Auth error:", error);
      let msg = "Erro na autenticação.";
      if (error.code === "auth/email-already-in-use") msg = "Este e-mail já está em uso.";
      if (error.code === "auth/invalid-credential") msg = "E-mail ou senha incorretos.";
      if (error.code === "auth/weak-password") msg = "A senha deve ter pelo menos 6 caracteres.";
      toast.error(msg);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      toast.success("Sessão encerrada.");
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleBuy = async (pkg: PackageData) => {
    if (!user) {
      toast.error("Você precisa estar logado para comprar.");
      handleLogin();
      return;
    }

    setSelectedPackage(pkg);
    setPixData(null);
    setIsPixModalOpen(true);
  };

  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      return numbers
        .replace(/(\d{2})(\d)/, "($1) $2")
        .replace(/(\d{5})(\d)/, "$1-$2")
        .replace(/(-\d{4})\d+?$/, "$1");
    }
    return numbers;
  };

  const formatTaxId = (value: string) => {
    const numbers = value.replace(/\D/g, "");
    if (numbers.length <= 11) {
      return numbers
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d)/, "$1.$2")
        .replace(/(\d{3})(\d{1,2})/, "$1-$2")
        .replace(/(-\d{2})\d+?$/, "$1");
    }
    return numbers;
  };

  const generatePix = async () => {
    if (!selectedPackage || !user) return;
    
    if (!customerData.name || !customerData.email || !customerData.phone || !customerData.taxId) {
      toast.error("Por favor, preencha todos os campos.");
      return;
    }

    const cleanTaxId = customerData.taxId.replace(/\D/g, "");
    if (cleanTaxId.length !== 11 && cleanTaxId.length !== 14) {
      toast.error("CPF ou CNPJ inválido. Verifique os números.");
      return;
    }

    setIsGenerating(true);
    try {
      // Robust price parsing from spreadsheet
      const cleanedPrice = selectedPackage.price.replace(/[^\d.,]/g, "");
      const basePrice = cleanedPrice.includes(",") && cleanedPrice.indexOf(",") > cleanedPrice.indexOf(".") 
        ? parseFloat(cleanedPrice.replace(/\./g, "").replace(",", "."))
        : parseFloat(cleanedPrice.replace(/,/g, ""));

      if (isNaN(basePrice) || basePrice <= 0) {
        toast.error("Erro ao processar o preço do pacote.");
        setIsGenerating(false);
        return;
      }

      const priceValue = selectedPackage.name === "Pacote 3" ? quantity * basePrice : basePrice;

      console.log("DEBUG: Requesting PIX generation for", selectedPackage.name, "Amount:", priceValue);
      const response = await axios.post("/api/pix/generate", { 
        amount: priceValue, 
        packageId: selectedPackage.name === "Pacote 3" ? `Pacote 3 (${quantity} perfis)` : selectedPackage.name,
        customer: customerData,
        userId: user?.uid || "guest"
      });
      
      const data = response.data;
      console.log("DEBUG: PIX Response received:", data);

      // Save customer data to Firestore for future use
      if (user) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          customerName: customerData.name,
          customerEmail: customerData.email,
          customerPhone: customerData.phone,
          customerTaxId: customerData.taxId
        });
      }
      
      // Handle PIX data response
      if (data.pixCode && data.pixCode.startsWith("http")) {
        console.log("DEBUG: Handling as Checkout URL");
        // For checkout URLs, we'll show a button to open it
        const qrCodeUrl = await QRCode.toDataURL(data.pixCode);
        setPixData({
          pixCode: data.pixCode,
          qrCode: qrCodeUrl,
          isUrl: true,
          txId: data.txId
        });
      } else if (data.pixCode) {
        console.log("DEBUG: Handling as Direct PIX");
        let qrCodeUrl = data.qrCode;
        
        // If the API didn't return a QR code image, generate one from the PIX code
        if (!qrCodeUrl) {
          console.log("DEBUG: Generating QR Code locally from pixCode");
          qrCodeUrl = await QRCode.toDataURL(data.pixCode);
        } else if (!qrCodeUrl.startsWith("data:")) {
          // Ensure base64 has the correct prefix
          qrCodeUrl = `data:image/png;base64,${qrCodeUrl}`;
        }
        
        setPixData({
          pixCode: data.pixCode,
          qrCode: qrCodeUrl,
          isUrl: false,
          txId: data.txId
        });
      } else {
        throw new Error("O servidor não retornou um código PIX válido.");
      }
    } catch (error: any) {
      console.error("CRITICAL: Error generating PIX:", error);
      const errorData = error.response?.data;
      const errorMsg = errorData?.details || errorData?.error || error.message || "Erro ao gerar pagamento. Tente novamente.";
      toast.error(errorMsg, { duration: 8000 });
    } finally {
      setIsGenerating(false);
    }
  };

  const copyPixCode = () => {
    if (pixData?.pixCode) {
      navigator.clipboard.writeText(pixData.pixCode);
      toast.success("Código PIX copiado!");
    }
  };

  const availableAccountsCount = accounts.filter(a => a.Status === "à venda").length;

  if (isSuccessPage) {
    const lastPaidOrder = orders.find(o => o.status === "paid");
    
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4 md:p-6 selection:bg-tiktok-red selection:text-white relative overflow-hidden">
        {/* Aesthetic Background for Success Page */}
        <div className="absolute top-0 left-0 w-full h-full bg-mesh pointer-events-none opacity-50" />
        <div className="absolute -top-24 -right-24 w-64 h-64 bg-tiktok-cyan/10 blur-[100px] rounded-full" />
        <div className="absolute -bottom-24 -left-24 w-64 h-64 bg-tiktok-red/10 blur-[100px] rounded-full" />

        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="max-w-xl w-full bg-white/[0.03] backdrop-blur-3xl border border-white/5 rounded-3xl p-6 md:p-10 shadow-2xl text-center relative z-10"
        >
          <div className="w-12 h-12 md:w-16 md:h-16 bg-tiktok-cyan/10 rounded-2xl flex items-center justify-center mx-auto mb-4 md:mb-6 border border-tiktok-cyan/20">
            <CheckCircle2 className="w-6 h-6 md:w-8 md:h-8 text-tiktok-cyan" />
          </div>
          <h1 className="text-2xl md:text-3xl font-black text-white mb-2 md:mb-3 italic tracking-tighter uppercase">Arsenal Liberado</h1>
          <p className="text-white/40 mb-4 md:mb-6 text-sm md:text-base leading-relaxed font-medium">
            Seu pagamento foi confirmado. Suas BC's já estão disponíveis para mobilização.
          </p>
          
          <div className="bg-white/5 p-4 md:p-6 rounded-2xl border border-white/5 mb-6 md:mb-8 text-left">
            <div className="flex items-center justify-between mb-3 md:mb-4">
              <p className="text-[9px] uppercase tracking-[0.2em] text-white/20 font-black">Suas BC's Entregues</p>
              {lastPaidOrder?.accounts && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-7 px-3 md:h-8 md:px-4 text-[9px] font-black uppercase tracking-widest text-tiktok-cyan hover:bg-tiktok-cyan/10"
                  onClick={() => {
                    navigator.clipboard.writeText(lastPaidOrder.accounts);
                    toast.success("Copiado!");
                  }}
                >
                  <Copy className="w-3 h-3 md:w-3.5 md:h-3.5 mr-1.5" /> Copiar
                </Button>
              )}
            </div>
            
            <div className="space-y-4">
              {lastPaidOrder?.accounts ? (
                <pre className="text-[10px] md:text-xs font-mono text-white/60 whitespace-pre-wrap break-all bg-black/40 p-4 md:p-6 rounded-xl md:rounded-2xl border border-white/5 max-h-32 md:max-h-40 overflow-y-auto custom-scrollbar">
                  {lastPaidOrder.accounts}
                </pre>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-white/5 border border-white/5 flex items-center justify-center">
                    <Zap className="w-4 h-4 text-tiktok-cyan animate-pulse" />
                  </div>
                  <span className="text-[10px] font-medium text-white/20 italic tracking-tight">Liberando BC's no sistema...</span>
                </div>
              )}
            </div>
            <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2">
              <Check className="w-3 h-3 text-tiktok-cyan" />
              <span className="text-[9px] font-black uppercase tracking-widest text-tiktok-cyan/50 italic">BC'S VERIFICADAS E PRONTAS.</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 md:gap-4">
            <Button 
              className="h-12 md:h-14 rounded-full bg-tiktok-cyan hover:bg-tiktok-cyan/90 text-black font-black uppercase italic tracking-tighter"
              onClick={() => {
                setIsSuccessPage(false);
                setView("orders");
                window.history.pushState({}, "", "/");
              }}
            >
              Meus Pedidos
            </Button>
            <Button 
              variant="outline" 
              className="h-12 md:h-14 rounded-full border-white/10 text-white/50 hover:text-white font-black uppercase italic tracking-tighter"
              onClick={() => {
                window.history.pushState({}, "", "/");
                setIsSuccessPage(false);
                setView("home");
              }}
            >
              Voltar ao Início
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white font-sans selection:bg-tiktok-red selection:text-white relative">
      <Toaster position="top-center" richColors theme="dark" />
      
      {/* Background Decor */}
      <div className="fixed inset-0 bg-mesh opacity-[0.03] pointer-events-none z-0" />
      <div className="fixed bottom-0 left-0 w-full h-[50vh] bg-gradient-to-t from-tiktok-red/[0.03] to-transparent pointer-events-none z-0" />
      <div className="fixed -bottom-48 -right-48 w-96 h-96 bg-tiktok-cyan/[0.05] blur-[150px] rounded-full pointer-events-none z-0" />
      {/* Interactive Retracting Header */}
      <div className="fixed top-5 md:top-6 left-0 right-0 z-50 px-4 md:px-6">
        <motion.nav 
          style={{ backgroundColor: headerBg, borderColor: headerBorder }}
          className="max-w-6xl mx-auto h-14 md:h-16 flex items-center border rounded-full backdrop-blur-xl transition-all shadow-2xl"
        >
          <div className="w-full flex items-center justify-between px-4 md:px-6">
          <button 
            onClick={() => { setView("home"); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
            className="flex items-center gap-2 md:gap-3 group transition-transform hover:scale-105"
          >
            <motion.div style={{ scale: headerScale }} className="flex items-center gap-2 md:gap-3">
              <div className="w-8 h-8 md:w-9 md:h-9 bg-tiktok-red rounded-lg flex items-center justify-center shadow-[0_0_15px_rgba(255,29,77,0.4)] transition-all group-hover:shadow-[0_0_20px_rgba(255,29,77,0.6)]">
                <Zap className="text-white w-4 h-4 md:w-5 md:h-5 fill-current" />
              </div>
              <span className="hidden md:block text-lg font-black italic tracking-tighter text-white">Tiktok<span className="text-tiktok-cyan">Escale</span></span>
            </motion.div>
          </button>
          
          <div className="hidden lg:flex items-center gap-6 text-[11px] font-bold tracking-widest text-white/50">
            <button onClick={() => navigateTo("vsl")} className="hover:text-tiktok-red transition-all cursor-pointer text-white/40">Estratégia</button>
            <button onClick={() => navigateTo("produtos")} className="hover:text-tiktok-red transition-all cursor-pointer text-white/40">Escale Agora</button>
            <button onClick={() => navigateTo("beneficios")} className="hover:text-tiktok-red transition-all cursor-pointer text-white/40">Vantagens</button>
          </div>

          <div className="flex items-center gap-2 md:gap-4">
            {user && (
              <Button 
                variant="ghost" 
                onClick={() => setView(view === "home" ? "orders" : "home")}
                className="text-white/70 font-bold hover:text-tiktok-cyan h-9 px-3 md:h-10 md:px-4 text-xs md:text-sm"
              >
                {view === "home" ? (
                  <><ShoppingBag className="w-4 h-4 md:w-5 md:h-5 md:mr-2" /> <span className="hidden sm:inline">Meus Pedidos</span></>
                ) : (
                  <><ArrowLeft className="w-4 h-4 md:w-5 md:h-5 md:mr-2" /> <span className="hidden sm:inline">Voltar</span></>
                )}
              </Button>
            )}
            
            {user ? (
               <div className="flex items-center gap-3">
               <Dialog>
                 <DialogTrigger 
                   render={
                     <Button variant="ghost" className="p-0 h-9 w-9 rounded-full overflow-hidden border border-white/10">
                       <img src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email || "U")}&background=FF1D4D&color=fff&bold=true`} alt="User" className="w-full h-full object-cover" />
                     </Button>
                   }
                 />
                 <DialogContent className="sm:max-w-[300px] border-white/10 bg-black/95 text-white">
                   <div className="flex flex-col items-center gap-4 py-4">
                     <img src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email || "U")}&background=FF1D4D&color=fff&bold=true`} alt="User" className="w-20 h-20 rounded-full border-2 border-tiktok-red object-cover shadow-[0_0_20px_rgba(255,29,77,0.3)]" />
                     <div className="text-center">
                       <p className="font-bold">{user.displayName || user.email?.split('@')[0]}</p>
                       <p className="text-sm text-white/50">{user.email}</p>
                     </div>
                     <Button variant="destructive" className="w-full bg-tiktok-red text-white font-normal hover:bg-tiktok-red/90" onClick={handleLogout}>
                       <LogOut className="w-4 h-4 mr-2" /> Sair
                     </Button>
                   </div>
                 </DialogContent>
               </Dialog>
             </div>
            ) : (
              <Button onClick={handleLogin} className="rounded-full bg-white text-black font-black hover:bg-tiktok-cyan transition-all h-10 px-6">
                ENTRAR
              </Button>
            )}
          </div>
        </div>
      </motion.nav>
    </div>

      <Dialog open={isAuthModalOpen} onOpenChange={setIsAuthModalOpen}>
        <DialogContent className="sm:max-w-[400px] bg-black/95 border-white/10 text-white rounded-[24px] p-6 md:p-8 overflow-hidden backdrop-blur-2xl shadow-[0_0_100px_rgba(0,0,0,1)]">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-tiktok-red via-white to-tiktok-cyan" />
          
          <DialogHeader className="space-y-2 text-center">
            <DialogTitle className="text-2xl font-black italic tracking-tighter uppercase">
              {authMode === "login" ? "BEM-VINDO" : "CADASTRE-SE"}
            </DialogTitle>
            <DialogDescription className="text-white/40 font-bold uppercase tracking-widest text-[9px]">
              {authMode === "login" 
                ? "Entre para mobilizar seu arsenal de escala." 
                : "Crie sua conta para começar a escalar."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEmailAuth} className="space-y-4 mt-6">
            {authMode === "register" && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-black uppercase tracking-widest text-white/30 ml-2">NOME COMPLETO</p>
                <input
                  type="text"
                  placeholder="Seu nome"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  className="w-full bg-white/5 border border-white/10 rounded-xl h-12 px-5 text-sm focus:outline-none focus:border-tiktok-cyan/50 transition-all font-medium placeholder:text-white/10"
                />
              </div>
            )}
            
            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/30 ml-2">E-MAIL</p>
              <input
                type="email"
                placeholder="seu@email.com"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl h-12 px-5 text-sm focus:outline-none focus:border-tiktok-cyan/50 transition-all font-medium placeholder:text-white/10"
              />
            </div>

            <div className="space-y-1.5">
              <p className="text-[9px] font-black uppercase tracking-widest text-white/30 ml-2">SENHA</p>
              <input
                type="password"
                placeholder="••••••••"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-white/5 border border-white/10 rounded-xl h-12 px-5 text-sm focus:outline-none focus:border-tiktok-cyan/50 transition-all font-medium placeholder:text-white/10"
              />
            </div>

            <Button 
              type="submit"
              className="w-full h-12 rounded-xl bg-white text-black font-black uppercase italic tracking-tighter hover:bg-tiktok-cyan transition-all text-sm shadow-xl"
            >
              {authMode === "login" ? "ENTRAR AGORA" : "CRIAR CONTA"}
            </Button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center"><span className="w-full border-t border-white/5" /></div>
            <div className="relative flex justify-center text-[9px] uppercase font-black tracking-widest"><span className="bg-black/95 px-4 text-white/20">OU CONTINUE COM</span></div>
          </div>

          <Button 
            variant="outline"
            onClick={handleGoogleLogin}
            className="w-full h-12 rounded-xl border-white/5 bg-white/5 hover:bg-white/10 text-white font-black uppercase italic tracking-tighter flex items-center justify-center gap-3 text-xs"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
              <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.66l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            GOOGLE ACCOUNT
          </Button>

          <p className="mt-6 text-center text-[9px] font-bold uppercase tracking-widest text-white/30">
            {authMode === "login" ? "NÃO TEM UMA CONTA?" : "JÁ TEM UMA CONTA?"}
            <button 
              onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
              className="ml-2 text-tiktok-cyan hover:underline underline-offset-4"
            >
              {authMode === "login" ? "CADASTRE-SE" : "FAÇA LOGIN"}
            </button>
          </p>
        </DialogContent>
      </Dialog>

      <main className="pt-2 md:pt-20">
        {view === "home" ? (
          <>
            {/* Elite Hero Section */}
            <section className="relative md:min-h-[90vh] min-h-[50vh] flex items-start md:items-center justify-center overflow-hidden px-4 md:px-6 pt-16 md:pt-0">
              {/* Background Accents */}
              <div className="absolute top-1/4 left-1/4 w-[200px] md:w-[300px] h-[200px] md:h-[300px] bg-tiktok-red/20 blur-[100px] md:blur-[120px] rounded-full animate-pulse" />
              <div className="absolute bottom-1/4 right-1/4 w-[200px] md:w-[300px] h-[200px] md:h-[300px] bg-tiktok-cyan/10 blur-[100px] md:blur-[120px] rounded-full animate-pulse delay-1000" />
              
              <div className="max-w-7xl mx-auto text-center relative z-10 w-full">
                <motion.div
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.8, ease: "easeOut" }}
                >
                  <Badge className="bg-white/5 text-white/50 border-white/10 mb-6 md:mb-8 rounded-full px-4 md:px-5 py-1.5 uppercase tracking-widest text-[8px] md:text-[9px] font-black backdrop-blur-md">
                    #1 PLATAFORMA DE CONTINGÊNCIA TIKTOK
                  </Badge>
                  
                  <motion.h1 
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.2, duration: 0.8 }}
                    className="text-3xl md:text-5xl font-black tracking-tight italic text-white mb-8 md:mb-12 uppercase flex flex-col md:flex-row items-center justify-center gap-2 md:gap-x-4"
                  >
                    <span>ESCALE</span>
                    <div className="relative inline-block h-[1.2em] overflow-hidden min-w-[280px] md:min-w-[450px]">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={headlineWordIndex}
                          initial={{ y: 40, opacity: 0 }}
                          animate={{ y: 0, opacity: 1 }}
                          exit={{ y: -40, opacity: 0 }}
                          transition={{ duration: 0.5, ease: "circOut" }}
                          className="absolute inset-0 bg-gradient-to-r from-tiktok-red to-tiktok-cyan bg-clip-text text-transparent w-full text-center"
                        >
                          {headlineWords[headlineWordIndex]}
                        </motion.span>
                      </AnimatePresence>
                    </div>
                  </motion.h1>
                  
                  {/* VSL Section moved to hero fold */}
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 0.4, duration: 0.8 }}
                    className="relative max-w-4xl mx-auto aspect-video bg-white/5 rounded-3xl md:rounded-[40px] border border-white/10 overflow-hidden group shadow-2xl"
                  >
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent z-10" />
                    <img 
                      src="https://picsum.photos/seed/tech/1280/720" 
                      alt="VSL Preview" 
                      className="w-full h-full object-cover opacity-40 group-hover:scale-105 transition-transform duration-700"
                      referrerPolicy="no-referrer"
                    />
                    <div className="absolute inset-0 flex items-center justify-center z-20">
                      <motion.button 
                        whileHover={{ scale: 1.1 }}
                        whileTap={{ scale: 0.95 }}
                        className="w-16 h-16 bg-tiktok-red rounded-full flex items-center justify-center shadow-lg cursor-pointer"
                      >
                        <PlayCircle className="w-8 h-8 text-white fill-current" />
                      </motion.button>
                    </div>
                    <div className="absolute bottom-6 left-8 z-20 text-left">
                      <h3 className="text-xl font-black italic tracking-tighter">ESTRATÉGIA DE ESCALA 2024</h3>
                      <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest">Contingência de Elite para anúncios</p>
                    </div>
                  </motion.div>
                </motion.div>
              </div>
            </section>

        {/* Products Section */}
        <section id="produtos" className="py-12 md:py-20 relative">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-[500px] bg-tiktok-red/5 blur-[120px] rounded-full pointer-events-none" />
          
          <div className="max-w-7xl mx-auto px-4 md:px-6 relative z-10 text-white">
            <div className="text-center mb-10 md:mb-16 relative">
              <Badge className="bg-tiktok-red/10 text-tiktok-red border-tiktok-red/20 mb-4 md:mb-6 rounded-full px-5 md:px-6 py-1.5 uppercase tracking-widest text-[9px] md:text-[10px] font-black">
                Packs de Elite
              </Badge>
              <h2 className="text-3xl md:text-5xl font-black italic tracking-tighter uppercase leading-none px-4">ESCOLHA SEU ARSENAL</h2>
              <p className="text-white/40 text-sm md:text-lg max-w-2xl mx-auto font-medium mt-4 md:mt-6 px-4">
                Selecione o volume ideal para sua operação. Entrega 100% automática.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              {loading ? (
                Array(3).fill(0).map((_, i) => (
                  <Card key={i} className="rounded-[44px] border-white/10 bg-white/5 overflow-hidden h-[600px]">
                    <CardHeader className="p-8">
                      <Skeleton className="h-8 w-1/2 mb-4 bg-white/10" />
                      <Skeleton className="h-4 w-full bg-white/10" />
                    </CardHeader>
                    <CardContent className="p-8 pt-0">
                      <Skeleton className="h-20 w-full mb-6 bg-white/10" />
                      <Skeleton className="h-12 w-full rounded-2xl bg-white/10" />
                    </CardContent>
                  </Card>
                ))
              ) : Array.isArray(packages) && packages.length > 0 ? (
                packages.map((pkg, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, y: 20 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.1 }}
                  >
                    <Card className={cn(
                      "rounded-3xl border-white/10 bg-white/[0.03] backdrop-blur-xl transition-all duration-500 hover:border-tiktok-red group relative overflow-visible h-full flex flex-col text-white",
                      i === 1 ? 'ring-1 ring-tiktok-red shadow-[0_0_80px_rgba(255,29,77,0.15)] bg-white/[0.05]' : 'hover:bg-white/[0.06]'
                    )}>
                      {i === 1 && (
                        <div className="absolute top-0 right-0 bg-tiktok-red text-white px-6 py-1.5 rounded-bl-2xl rounded-tr-3xl text-[9px] font-black uppercase tracking-[0.2em] z-20">
                          Recomendado
                        </div>
                      )}
                      
                      <CardHeader className="p-8 pb-4 relative">
                        <div className="flex justify-between items-start">
                          <div>
                            <CardTitle className="text-2xl font-black text-white italic tracking-tighter mb-1 group-hover:text-tiktok-red transition-all">
                              {pkg.name}
                            </CardTitle>
                            <CardDescription className="text-white/30 font-bold tracking-widest text-[8px]">
                              {pkg.name === "Pacote 3" ? "Volume Industrial" : (pkg.profiles === "1" ? "Entrada Estratégia" : "Escala Acelerada")}
                            </CardDescription>
                          </div>
                          <InfoTooltip 
                            title="Análise de Custo"
                            content={
                              <>
                                <p className="mb-2">Este arsenal é entregue com protocolos de elite e suporte dedicado.</p>
                                <div className="space-y-1">
                                  <div className="flex justify-between border-b border-white/5 pb-1">
                                    <span>Preço por BC:</span>
                                    <span className="text-white font-bold">R$ {i === 0 ? "60,00" : i === 1 ? "50,00" : "46,66"}</span>
                                  </div>
                                  <div className="flex justify-between pt-1">
                                    <span>Preço (3 BCs):</span>
                                    <span className="text-tiktok-cyan font-bold">R$ {i === 0 ? "180" : i === 1 ? "150" : "140"}</span>
                                  </div>
                                </div>
                              </>
                            } 
                          />
                        </div>
                      </CardHeader>

                      <CardContent className="p-8 pt-0 flex-grow">
                        <div className="flex flex-col gap-1 mb-6">
                          <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black text-white italic tracking-tighter">
                              R$ {pkg.name === "Pacote 3" ? (quantity * 140).toLocaleString('pt-BR') : pkg.price}
                            </span>
                            <span className="text-white/20 font-bold text-[8px] uppercase tracking-widest">/ único</span>
                          </div>
                          <p className="text-[10px] font-bold text-tiktok-cyan italic tracking-tight opacity-80">
                            Preço por Trio de BC's: R$ {i === 0 ? "180" : i === 1 ? "150" : "140"}
                          </p>
                        </div>
                        
                        <div className="space-y-3 mb-8 text-xs">
                          {[
                            { text: pkg.name === "Pacote 3" ? `${quantity * 3} BC's Completos` : `${pkg.profiles} BC's Completos`, icon: TrendingUp },
                            { text: pkg.name === "Pacote 3" ? `${quantity * 3 * 30} Contas no total` : `${pkg.accounts} Contas no total`, icon: Users },
                            { text: "Acesso Outlook + TikTok", icon: CheckCircle2 },
                            { text: "Liberação Imediata", icon: Zap }
                          ].map((feat, idx) => (
                            <div key={idx} className="flex items-center gap-3 text-white/70">
                              <div className="w-4 h-4 flex items-center justify-center">
                                <feat.icon className="w-3.5 h-3.5 text-tiktok-cyan" />
                              </div>
                              <span className="text-sm font-bold tracking-tight">{feat.text}</span>
                            </div>
                          ))}
                        </div>

                        {pkg.name === "Pacote 3" ? (
                          <div className="flex items-center gap-2">
                            <div className="flex items-center bg-white/5 rounded-2xl border border-white/5 p-1 h-14">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-10 w-8 rounded-xl text-white hover:bg-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setQuantity(Math.max(5, quantity - 1));
                                }}
                              >
                                -
                              </Button>
                              <span className="text-lg font-black italic text-white w-8 text-center">{quantity}</span>
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-10 w-8 rounded-xl text-white hover:bg-white/10"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setQuantity(quantity + 1);
                                }}
                              >
                                +
                              </Button>
                            </div>
                            <Button 
                              onClick={() => handleBuy(pkg)}
                              className={cn(
                                "flex-1 h-14 rounded-2xl text-sm font-black italic tracking-tight transition-all uppercase",
                                "bg-white text-black hover:bg-tiktok-cyan hover:text-black"
                              )}
                            >
                              Comprar Agora
                            </Button>
                          </div>
                        ) : (
                          <Button 
                            onClick={() => handleBuy(pkg)}
                            className={cn(
                              "w-full h-14 rounded-2xl text-sm font-black italic tracking-tight transition-all uppercase",
                              i === 1 
                                ? "bg-tiktok-red hover:bg-tiktok-cyan hover:text-black text-white shadow-[0_0_20px_rgba(255,29,77,0.2)]" 
                                : "bg-white text-black hover:bg-tiktok-cyan hover:text-black"
                            )}
                          >
                            Comprar Agora
                          </Button>
                        )}
                      </CardContent>
                    </Card>
                  </motion.div>
                ))
              ) : (
                <div className="col-span-3 text-center py-20 text-white/20 font-bold uppercase tracking-widest italic">
                  ARSENAL INDISPONÍVEL NO MOMENTO.
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Stats / Benefits Section */}
        <section id="beneficios" className="py-10 md:py-16 relative overflow-hidden bg-white/[0.01]">
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-64 bg-tiktok-cyan/[0.03] blur-[120px] rounded-full" />
          
          <div className="max-w-7xl mx-auto px-4 md:px-6 relative z-10">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
              {[
                { icon: Zap, label: "Entrega Instantânea", desc: "Receba seus acessos imediatamente após o PIX via Auto-Pix 24/7.", color: "tiktok-red" },
                { icon: ShieldCheck, label: "Máxima Proteção", desc: "Contas verificadas com protocolos de elite para evitar bloqueios.", color: "tiktok-cyan" },
                { icon: Users, label: "Suporte Especialista", desc: "Chat em tempo real com quem entende de escala industrial no TikTok.", color: "white" },
              ].map((item, i) => (
                <motion.div 
                  key={i} 
                  initial={{ opacity: 0, scale: 0.95 }}
                  whileInView={{ opacity: 1, scale: 1 }}
                  whileHover={{ 
                    scale: 1.02,
                    backgroundColor: "rgba(255,255,255,0.06)",
                    borderColor: i === 0 ? "rgba(255,29,77,0.3)" : i === 1 ? "rgba(1,251,247,0.3)" : "rgba(255,255,255,0.2)"
                  }}
                  viewport={{ once: true }}
                  transition={{ 
                    type: "spring",
                    stiffness: 300,
                    damping: 20
                  }}
                  className="bg-white/[0.03] border border-white/5 p-8 rounded-3xl transition-all group relative overflow-hidden"
                >
                  <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                  <div className="relative z-10">
                    <div className="w-12 h-12 rounded-xl bg-white/5 flex items-center justify-center mb-6 group-hover:bg-white/10 transition-all">
                      <item.icon className={cn("w-6 h-6", item.color === "tiktok-red" ? "text-tiktok-red" : item.color === "tiktok-cyan" ? "text-tiktok-cyan" : "text-white")} />
                    </div>
                    <h3 className="text-xl font-bold text-white mb-4 italic tracking-tight uppercase">{item.label}</h3>
                    <p className="text-sm text-white/40 leading-relaxed font-medium">{item.desc}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Security Section Removed as requested */}


        <section id="suporte" className="py-12 md:py-24 relative overflow-hidden">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-tiktok-red/5 blur-[120px] rounded-full pointer-events-none" />
          <div className="max-w-3xl mx-auto px-6 text-center text-white relative z-10">
            <h2 className="text-3xl md:text-4xl font-black italic tracking-tighter mb-4 md:mb-6 uppercase text-white leading-none">DIFÍCIL DE ACREDITAR?</h2>
            <p className="text-white/40 text-xs md:text-base mb-8 md:mb-10 font-bold uppercase tracking-widest">Nossa equipe de especialistas está pronta para te provar na prática.</p>
            <a 
              href="https://wa.me/5500000000000" 
              target="_blank" 
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ variant: "outline", size: "lg" }),
                "rounded-full px-8 md:px-12 h-12 md:h-14 border-white/10 bg-white/5 hover:bg-tiktok-red hover:text-white hover:border-tiktok-red text-white font-black uppercase italic tracking-tighter transition-all text-xs md:text-base"
              )}
            >
              FALAR COM SUPORTE
            </a>
          </div>
        </section>

        {/* Floating Footer */}
        <div className="px-6 pb-12">
          <footer className="max-w-7xl mx-auto py-8 bg-white/[0.03] backdrop-blur-xl border border-white/5 rounded-3xl px-8 flex flex-col md:flex-row justify-between items-center gap-8">
            <div className="flex items-center gap-4 grayscale opacity-30 hover:grayscale-0 hover:opacity-100 transition-all cursor-pointer">
              <Zap className="text-white w-5 h-5 fill-current" />
              <span className="text-base font-black italic tracking-tighter text-white">Tiktok<span className="text-white/40">Escale</span></span>
            </div>
            <p className="text-white/10 text-[9px] font-black uppercase tracking-[0.4em] text-center">
              © 2024 TIKTOK ESCALE • PREMIUM BC'S ARSENAL
            </p>
            <div className="flex items-center gap-8 text-[9px] text-white/30 font-black tracking-widest uppercase">
              <a href="#" className="hover:text-tiktok-red transition-all">Privacidade</a>
              <a href="#" className="hover:text-tiktok-cyan transition-all">Termos</a>
            </div>
          </footer>
        </div>
      </>
    ) : (
      <div className="max-w-5xl mx-auto px-4 md:px-6 py-10 md:py-16 space-y-8 md:space-y-12 min-h-screen relative z-20">
        {/* Aesthetic Background for Orders View */}
        <div className="fixed inset-0 bg-mesh opacity-[0.05] pointer-events-none -z-10" />
        <div className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-tiktok-red/5 blur-[150px] rounded-full -z-10 pointer-events-none" />

        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 md:gap-8 border-b border-white/10 pb-6 md:pb-10">
          <div className="space-y-1.5 md:space-y-3 text-left">
             <Badge className="bg-tiktok-cyan/10 text-tiktok-cyan border-tiktok-cyan/20 px-3 md:px-4 py-1 rounded-full text-[8px] md:text-[9px] font-black uppercase tracking-widest">Centro de Comando</Badge>
             <h2 className="text-3xl md:text-4xl font-black italic text-white tracking-tighter uppercase leading-none">Meus Pedidos</h2>
             <p className="text-[10px] md:text-sm text-white/40 font-bold uppercase tracking-widest leading-tight">Acompanhe e baixe suas BC's de escala</p>
          </div>
          <Button 
            variant="outline" 
            onClick={() => setView("home")}
            className="rounded-full border-white/10 hover:border-tiktok-red h-10 md:h-12 px-6 md:px-8 font-black uppercase italic tracking-tighter text-xs md:text-sm transition-all w-fit"
          >
            <ArrowLeft className="mr-2 w-3.5 h-3.5" /> Voltar
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 md:gap-8">
          {orders.length > 0 ? (
            orders.map((order) => (
              <motion.div
                key={order.id}
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <Card className="overflow-hidden border-white/5 bg-white/[0.03] backdrop-blur-xl hover:border-tiktok-red transition-all group rounded-3xl text-white p-0.5 md:p-1">
                  <div className="p-5 md:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6 md:gap-10">
                    <div className="flex items-center gap-4 md:gap-8">
                      <div className={cn(
                        "w-12 h-12 md:w-16 md:h-16 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0 shadow-2xl transition-all",
                        order.status === "paid" ? "bg-tiktok-cyan text-black" : 
                        order.status === "pending" ? "bg-tiktok-red text-white" : "bg-white/10 text-white/30"
                      )}>
                        <ShoppingBag className="w-6 h-6 md:w-8 md:h-8" />
                      </div>
                      <div className="space-y-1 md:space-y-2">
                        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                           <h3 className="text-lg md:text-2xl font-black italic text-white tracking-tighter uppercase leading-none">{order.packageId}</h3>
                           <Badge className={cn(
                             "w-fit rounded-full px-3 py-1 text-[8px] md:text-[9px] font-black uppercase tracking-widest border-none",
                             order.status === "paid" ? "bg-tiktok-cyan/20 text-tiktok-cyan" : 
                             order.status === "pending" ? "bg-tiktok-red/20 text-tiktok-red" : "bg-white/5 text-white/30"
                           )}>
                             {order.status === "paid" ? "LIBERADO" : order.status === "pending" ? "PENDENTE" : "EXPIRADO"}
                           </Badge>
                        </div>
                        <div className="flex items-center gap-2 md:gap-4 text-white/30 font-bold uppercase tracking-widest text-[8px] md:text-[9px]">
                           <span>ID: {order.id.slice(0, 8)}</span>
                           <span className="w-0.5 h-0.5 rounded-full bg-white/30" />
                           <span>{new Date(order.createdAt).toLocaleDateString("pt-BR")}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col md:items-end gap-2 md:gap-5">
                      <p className="text-lg md:text-3xl font-black italic text-white tracking-tighter">R$ {order.amount.toFixed(2)}</p>
                      {order.status === "paid" && order.accounts ? (
                        <div className="flex gap-4">
                           <Button 
                            className="w-full sm:w-auto h-9 md:h-12 bg-white text-black hover:bg-tiktok-cyan font-black italic tracking-tighter uppercase rounded-full px-5 md:px-8 transition-all scale-100 hover:scale-105 text-[10px] md:text-sm"
                            onClick={() => {
                              const blob = new Blob([order.accounts], { type: 'text/plain' });
                              const url = window.URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `tiktok-escale-bc-${order.id}.txt`;
                              a.click();
                            }}
                          >
                            <Download className="w-3 h-3 md:w-4 md:h-4 mr-2" /> Baixar BC's
                          </Button>
                        </div>
                      ) : order.status === "pending" ? (
                        <Button 
                          className="w-full sm:w-auto bg-tiktok-red hover:bg-tiktok-red/90 text-white font-black italic tracking-tighter uppercase rounded-full h-9 md:h-12 px-6 md:px-10 transition-all shadow-[0_0_20px_rgba(255,29,77,0.3)] text-[10px] md:text-sm"
                          onClick={() => {
                            setPixData({
                              pixCode: order.pixCode,
                              qrCode: "", 
                              isUrl: order.pixCode.startsWith("http")
                            });
                            setIsPixModalOpen(true);
                          }}
                        >
                          Pagar Agora
                        </Button>
                      ) : null}
                    </div>
                  </div>
                  
                  {order.status === "paid" && order.accounts && (
                    <div className="px-5 md:px-8 pb-5 md:pb-8">
                      <div className="bg-black/60 rounded-2xl md:rounded-[32px] p-4 md:p-6 border border-white/5 space-y-3 md:space-y-4">
                        <div className="flex items-center justify-between">
                          <p className="text-[8px] md:text-[9px] font-black text-white/30 uppercase tracking-[0.4em]">Acessos Entregues:</p>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-7 md:h-8 text-[8px] md:text-[9px] font-black uppercase text-tiktok-cyan hover:text-tiktok-cyan/80 p-0"
                            onClick={() => {
                              navigator.clipboard.writeText(order.accounts);
                              toast.success("Copiado!");
                            }}
                          >
                            <Copy className="w-3 h-3 mr-1" /> COPIAR
                          </Button>
                        </div>
                        <pre className="text-[10px] md:text-xs font-mono text-white/60 whitespace-pre-wrap break-all bg-black/40 p-4 md:p-6 rounded-xl md:rounded-2xl border border-white/5 max-h-32 md:max-h-40 overflow-y-auto custom-scrollbar">
                          {order.accounts}
                        </pre>
                        <div className="pt-2 flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-tiktok-cyan" />
                          <span className="text-[8px] md:text-[9px] font-black uppercase tracking-widest text-tiktok-cyan/50 italic">BC's verificadas e prontas.</span>
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              </motion.div>
            ))
          ) : (
            <div className="text-center py-40 bg-white/[0.02] rounded-[60px] border border-dashed border-white/10 flex flex-col items-center gap-8">
              <div className="w-24 h-24 bg-white/5 rounded-full flex items-center justify-center text-white/5">
                <ShoppingBag className="w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h3 className="text-3xl font-black italic text-white tracking-tighter uppercase leading-none">Sem Pedidos</h3>
                <p className="text-white/20 font-bold uppercase tracking-widest text-[10px] italic">Você ainda não mobilizou o arsenal Tiktok Escale.</p>
              </div>
              <Button 
                onClick={() => setView("home")}
                className="bg-tiktok-red hover:bg-tiktok-red/90 text-white font-black italic tracking-tighter uppercase rounded-full px-12 h-14 shadow-[0_0_40px_rgba(255,29,77,0.3)] text-base"
              >
                VER PACOTES
              </Button>
            </div>
          )}
        </div>
      </div>
    )}
  </main>

      <Dialog open={isPixModalOpen} onOpenChange={setIsPixModalOpen}>
        <DialogContent className="sm:max-w-[400px] rounded-[24px] p-0 overflow-hidden border-white/10 bg-black shadow-[0_0_100px_rgba(0,0,0,1)]">
          <div className="bg-gradient-to-br from-tiktok-red/10 to-black p-6 border-b border-white/5">
            <DialogHeader>
              <div className="w-10 h-10 bg-tiktok-red/20 rounded-xl flex items-center justify-center mb-3">
                 <CreditCard className="text-tiktok-red w-5 h-5" />
              </div>
              <DialogTitle className="text-2xl font-black italic text-white tracking-tighter uppercase leading-none mb-1">Pagamento</DialogTitle>
              <DialogDescription className="text-white/40 font-bold uppercase tracking-widest text-[8px]">
                 CHECKOUT SEGURO • ANTI-BLOCK PROTOCOL
              </DialogDescription>
            </DialogHeader>
          </div>
          
          <div className="p-6 max-h-[80vh] overflow-y-auto custom-scrollbar">
            {!pixData ? (
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">Nome Completo</label>
                    <input 
                      type="text" 
                      value={customerData.name}
                      onChange={(e) => setCustomerData({...customerData, name: e.target.value})}
                      className="w-full h-11 rounded-xl bg-white/5 border border-white/5 px-4 text-white text-sm font-bold focus:outline-none focus:ring-1 focus:ring-tiktok-red/50 transition-all"
                      placeholder="Nome do Comprador"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">E-mail para Entrega</label>
                    <input 
                      type="email" 
                      value={customerData.email}
                      onChange={(e) => setCustomerData({...customerData, email: e.target.value})}
                      className="w-full h-11 rounded-xl bg-white/5 border border-white/5 px-4 text-white text-sm font-bold focus:outline-none focus:ring-1 focus:ring-tiktok-red/50 transition-all"
                      placeholder="seu@contato.com"
                    />
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">Telefone</label>
                      <input 
                        type="text" 
                        value={customerData.phone}
                        onChange={(e) => setCustomerData({...customerData, phone: formatPhone(e.target.value)})}
                        className="w-full h-11 rounded-xl bg-white/5 border border-white/5 px-4 text-white text-sm font-bold focus:outline-none focus:ring-1 focus:ring-tiktok-red/50 transition-all"
                        placeholder="(00) 00000-0000"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-[9px] font-black text-white/30 uppercase tracking-[0.2em] ml-2">CPF / Tax ID</label>
                      <input 
                        type="text" 
                        value={customerData.taxId}
                        onChange={(e) => setCustomerData({...customerData, taxId: formatTaxId(e.target.value)})}
                        className="w-full h-11 rounded-xl bg-white/5 border border-white/5 px-4 text-white text-sm font-bold focus:outline-none focus:ring-1 focus:ring-tiktok-red/50 transition-all"
                        placeholder="000.000.000-00"
                      />
                    </div>
                  </div>
                </div>
                <Button 
                  onClick={generatePix}
                  disabled={isGenerating}
                  className="w-full h-12 rounded-xl bg-tiktok-red hover:bg-tiktok-red/90 text-white text-base font-black italic tracking-tighter shadow-xl transition-all uppercase"
                >
                  {isGenerating ? "GERANDO..." : "PAGAR AGORA"}
                </Button>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-6">
                <div className="relative group">
                  <div className="absolute inset-0 bg-tiktok-red/20 blur-[40px] rounded-full scale-75 group-hover:scale-100 transition-transform" />
                  <div className="bg-white p-4 rounded-[24px] shadow-2xl flex items-center justify-center relative z-10">
                    {pixData.qrCode ? (
                      <img src={pixData.qrCode} alt="PIX" className="w-48 h-48" />
                    ) : (
                      <div className="w-48 h-48 flex items-center justify-center italic font-black text-black">Aguardando...</div>
                    )}
                  </div>
                </div>

                <div className="w-full space-y-4">
                  {pixData.isUrl || pixData.pixCode.startsWith("http") ? (
                    <div className="space-y-4">
                      <div className="bg-white/5 p-6 rounded-[24px] border border-white/5 text-center">
                        <p className="text-tiktok-cyan font-black italic text-lg mb-2 tracking-tight">LINK DE CHECKOUT</p>
                        <p className="text-white/40 text-[10px] font-bold uppercase tracking-widest leading-relaxed">Pague agora no link oficial</p>
                      </div>
                      <Button 
                        className="w-full h-16 rounded-[24px] bg-tiktok-red hover:bg-tiktok-red/90 text-white text-xl font-black italic tracking-tighter shadow-2xl transition-all group"
                        onClick={() => window.open(pixData.pixCode, "_blank")}
                      >
                        ABRIR PAGAMENTO <ArrowRight className="ml-3 w-6 h-6 group-hover:translate-x-2 transition-transform" />
                      </Button>
                    </div>
                  ) : (
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex items-center justify-between gap-4">
                      <div className="flex-1 overflow-hidden">
                        <p className="text-[9px] uppercase tracking-[0.3em] text-white/30 font-black mb-1">PIX COPIA E COLA</p>
                        <p className="text-xs font-mono text-white/60 truncate italic">{pixData.pixCode}</p>
                      </div>
                      <Button 
                        size="icon" 
                        variant="ghost" 
                        className="h-10 w-10 rounded-xl bg-white/5 hover:bg-tiktok-cyan hover:text-black transition-all"
                        onClick={copyPixCode}
                      >
                        <Copy className="w-4 h-4" />
                      </Button>
                    </div>
                  )}

                  <div className="flex items-center gap-4 p-4 bg-tiktok-cyan/5 rounded-2xl border border-tiktok-cyan/10">
                    <div className="w-10 h-10 rounded-xl bg-tiktok-cyan/10 flex items-center justify-center shrink-0 shadow-[0_0_20px_rgba(1,251,247,0.15)]">
                      <Zap className="text-tiktok-cyan w-5 h-5 animate-pulse" />
                    </div>
                    <div className="flex-1">
                      <p className="text-[10px] text-tiktok-cyan font-black italic tracking-tight uppercase">DETECÇÃO ATIVA</p>
                      <p className="text-[9px] text-white/40 font-bold uppercase leading-tight mt-0.5">
                        Liberaremos suas contas automaticamente após o PIX.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="p-6 pt-0">
            <Button 
              variant="ghost" 
              className="w-full h-10 rounded-xl text-white/20 hover:text-white text-xs font-extrabold uppercase tracking-widest"
              onClick={() => setIsPixModalOpen(false)}
            >
              FECHAR
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
