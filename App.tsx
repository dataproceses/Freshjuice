
import React, { useState, useEffect, useMemo } from 'react';
import { Product, CartItem, Order, Page, OrderType, OrderStatus } from './types';
import { INITIAL_PRODUCTS, DELIVERY_FEE } from './constants';
import { geminiService } from './services/geminiService';
import { auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, db } from './services/firebase';
import { User } from 'firebase/auth';
import { 
  collection, 
  doc, 
  setDoc, 
  getDocs, 
  onSnapshot, 
  query, 
  where, 
  orderBy, 
  deleteDoc, 
  updateDoc,
  getDocFromServer
} from 'firebase/firestore';

// Error Handling Types
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Error Boundary Component
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      let errorMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error?.message || "");
        if (parsed.error) errorMessage = `Database Error: ${parsed.error}`;
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
          <div className="bg-white p-8 rounded-[2rem] shadow-xl max-w-md w-full text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center text-2xl mx-auto">
              <i className="fas fa-exclamation-triangle"></i>
            </div>
            <h2 className="text-2xl font-black text-slate-800">Oops!</h2>
            <p className="text-slate-500 text-sm">{errorMessage}</p>
            <button 
              onClick={() => window.location.reload()} 
              className="bg-emerald-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-emerald-700 transition-colors w-full"
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  const [currentPage, setCurrentPage] = useState<Page>('home');
  const [products, setProducts] = useState<Product[]>(INITIAL_PRODUCTS);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [lastOrder, setLastOrder] = useState<Order | null>(null);
  
  // Checkout Form
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [orderType, setOrderType] = useState<OrderType>('Pickup');
  const [address, setAddress] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiUpsell, setAiUpsell] = useState<Product | null>(null);
  const [aiConfirmationMessage, setAiConfirmationMessage] = useState('');

  // Chatbot State
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<{role: string, text: string}[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);

  // Admin / Product Management State
  const [isEnriching, setIsEnriching] = useState(false);
  const [isAddingProduct, setIsAddingProduct] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [newProductName, setNewProductName] = useState('');
  const [newProductPrice, setNewProductPrice] = useState('');
  const [newProductImage, setNewProductImage] = useState('');
  const [newProductIngredients, setNewProductIngredients] = useState('');
  const [newProductAvailable, setNewProductAvailable] = useState(true);
  const [isCreatingProduct, setIsCreatingProduct] = useState(false);

  // Auth State
  const [user, setUser] = useState<User | null>(null);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const isAdminUser = useMemo(() => {
    if (userRole === 'admin') return true;
    return user?.email === "tarikukebede200@gmail.com";
  }, [user, userRole]);

  // Firestore Connection Test
  useEffect(() => {
    async function testConnection() {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    }
    testConnection();
  }, []);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Fetch role from Firestore
        try {
          const userSnap = await getDocFromServer(doc(db, 'users', currentUser.uid));
          if (userSnap.exists()) {
            setUserRole(userSnap.data().role);
          } else {
            setUserRole('user');
          }
        } catch (e) {
          console.error("Failed to fetch user role", e);
          setUserRole('user');
        }
      } else {
        setUserRole(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Fetch Products
  useEffect(() => {
    const path = 'products';
    const unsubscribe = onSnapshot(collection(db, path), (snapshot) => {
      const fetchedProducts = snapshot.docs.map(doc => doc.data() as Product);
      if (fetchedProducts.length === 0) {
        // Use local fallback if DB is empty
        setProducts(INITIAL_PRODUCTS);
        
        // Only seed if user is admin
        const isAdminUser = auth.currentUser?.email === "tarikukebede200@gmail.com";
        if (isAdminUser) {
          INITIAL_PRODUCTS.forEach(async (p) => {
            try {
              await setDoc(doc(db, path, p.id), p);
            } catch (e) {
              console.error("Seeding failed", e);
            }
          });
        }
      } else {
        setProducts(fetchedProducts);
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return () => unsubscribe();
  }, [isAuthReady]); // Re-run when auth is ready to check for admin status

  // Fetch Orders
  useEffect(() => {
    if (!isAuthReady) return;
    const path = 'orders';
    let q = query(collection(db, path), orderBy('createdAt', 'desc'));
    
    // If not admin, only show own orders (simplified check, real admin check would be better)
    // For now, we'll filter client-side or use a more robust rule-based approach
    // But let's assume we want to filter by UID if user is logged in and not admin
    if (user && !isAdminUser) {
      q = query(collection(db, path), where('uid', '==', user.uid), orderBy('createdAt', 'desc'));
    } else if (!user) {
      setOrders([]);
      return;
    }

    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOrders(snapshot.docs.map(doc => doc.data() as Order));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    });
    return () => unsubscribe();
  }, [user, isAuthReady]);

  const handleLogin = async () => {
    try {
      setAuthError(null);
      const result = await signInWithPopup(auth, googleProvider);
      const loggedInUser = result.user;
      
      // Create/Update user document
      if (loggedInUser) {
        const userRef = doc(db, 'users', loggedInUser.uid);
        const userSnap = await getDocFromServer(userRef);
        
        if (!userSnap.exists()) {
          const role = loggedInUser.email === "tarikukebede200@gmail.com" ? 'admin' : 'user';
          await setDoc(userRef, {
            uid: loggedInUser.uid,
            email: loggedInUser.email,
            displayName: loggedInUser.displayName,
            photoURL: loggedInUser.photoURL,
            role: role,
            createdAt: Date.now()
          });
          setUserRole(role);
        } else {
          setUserRole(userSnap.data().role);
        }
      }
    } catch (error: any) {
      console.error("Login failed", error);
      if (error.code === 'auth/unauthorized-domain') {
        setAuthError('unauthorized-domain');
      }
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  // Cart Management
  const addToCart = (product: Product) => {
    if (!product.available) return;
    setCart(prev => {
      const existing = prev.find(i => i.id === product.id);
      if (existing) return prev.map(i => i.id === product.id ? {...i, quantity: i.quantity + 1} : i);
      return [...prev, {...product, quantity: 1}];
    });
  };

  const updateQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(i => i.id === id ? {...i, quantity: Math.max(1, i.quantity + delta)} : i));
  };

  const removeFromCart = (id: string) => setCart(prev => prev.filter(i => i.id !== id));

  const subtotal = useMemo(() => cart.reduce((s, i) => s + (i.price * i.quantity), 0), [cart]);
  const total = useMemo(() => subtotal + (orderType === 'Delivery' ? DELIVERY_FEE : 0), [subtotal, orderType]);

  // AI Upsell Hook
  useEffect(() => {
    if (currentPage === 'checkout' && cart.length > 0) {
      geminiService.getUpsellSuggestion(cart, products.filter(p => p.available)).then(setAiUpsell);
    }
  }, [currentPage, cart, products]);

  const handleCheckout = async () => {
    if (!customerName || !phone || (orderType === 'Delivery' && !address)) {
      return;
    }
    setIsProcessing(true);
    
    // Start generating AI message while simulating payment
    const aiMsgPromise = geminiService.generateConfirmationMessage(customerName);
    
    await new Promise(r => setTimeout(r, 1500)); // Simulate Payment processing
    
    const newOrder: Order = {
      id: Math.random().toString(36).substr(2, 6).toUpperCase(),
      customerName,
      phone,
      items: [...cart],
      total,
      type: orderType,
      address,
      status: 'New',
      createdAt: Date.now(),
      uid: user?.uid || ''
    };
    
    try {
      await setDoc(doc(db, 'orders', newOrder.id), newOrder);
      const aiMsg = await aiMsgPromise;
      setAiConfirmationMessage(aiMsg);
      setLastOrder(newOrder);
      setCart([]);
      setCustomerName('');
      setPhone('');
      setAddress('');
      setCurrentPage('confirmation');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'orders');
    } finally {
      setIsProcessing(false);
    }
  };

  const sendChatMessage = async () => {
    if (!chatInput.trim()) return;
    const userText = chatInput;
    setChatInput('');
    setChatMessages(prev => [...prev, {role: 'user', text: userText}]);
    setIsChatLoading(true);
    const response = await geminiService.getChatResponse(userText);
    setChatMessages(prev => [...prev, {role: 'bot', text: response}]);
    setIsChatLoading(false);
  };

  // AI Product Enrichment Logic
  const enrichAllDescriptions = async () => {
    setIsEnriching(true);
    try {
      const enrichedProducts = await Promise.all(products.map(async (p) => {
        const enhancedDesc = await geminiService.generateJuiceDescription(p.name, p.ingredients);
        return { ...p, description: enhancedDesc };
      }));
      setProducts(enrichedProducts);
    } catch (err) {
      console.error("Enrichment failed", err);
    } finally {
      setIsEnriching(false);
    }
  };

  const handleEditProduct = (p: Product) => {
    if (!isAdminUser) return;
    setEditingProduct(p);
    setNewProductName(p.name);
    setNewProductPrice(p.price.toString());
    setNewProductImage(p.image);
    setNewProductIngredients(p.ingredients.join(', '));
    setNewProductAvailable(p.available);
    setIsAddingProduct(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeForm = () => {
    setIsAddingProduct(false);
    setEditingProduct(null);
    setSaveError(null);
    setNewProductName('');
    setNewProductPrice('');
    setNewProductImage('');
    setNewProductIngredients('');
    setNewProductAvailable(true);
  };

  // Create or Update Product Logic
  const handleSaveProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdminUser) return;
    if (!newProductName || !newProductPrice || !newProductIngredients) {
      return;
    }

    setIsCreatingProduct(true);
    const priceNum = parseFloat(newProductPrice);
    if (isNaN(priceNum) || priceNum < 0) {
      setSaveError("Please enter a valid positive price.");
      setIsCreatingProduct(false);
      return;
    }

    const ingredientsArray = newProductIngredients.split(',').map(i => i.trim());
    
    try {
      let finalDescription = editingProduct?.description || '';
      setSaveError(null);
      
      // If it's new, ask to refresh AI description
      if (!editingProduct) {
        finalDescription = await geminiService.generateJuiceDescription(newProductName, ingredientsArray);
      }
      
      const productData: Product = {
        id: editingProduct ? editingProduct.id : Date.now().toString(),
        name: newProductName,
        price: priceNum,
        image: newProductImage || 'https://images.unsplash.com/photo-1622597467836-f30a588374f1?auto=format&fit=crop&q=80&w=400',
        ingredients: ingredientsArray,
        description: finalDescription,
        available: newProductAvailable,
      };

      await setDoc(doc(db, 'products', productData.id), productData);
      closeForm();
    } catch (err) {
      console.error("Save Product Error:", err);
      try {
        handleFirestoreError(err, editingProduct ? OperationType.UPDATE : OperationType.CREATE, 'products');
      } catch (formattedErr: any) {
        try {
          const parsed = JSON.parse(formattedErr.message);
          setSaveError(`Database Error: ${parsed.error}`);
        } catch (e) {
          setSaveError(formattedErr.message || "Failed to save product.");
        }
      }
    } finally {
      setIsCreatingProduct(false);
    }
  };

  const deleteProduct = async (id: string) => {
    if (!isAdminUser) return;
    try {
      await deleteDoc(doc(db, 'products', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, 'products');
    }
  };

  const visibleProducts = products.filter(p => p.available || currentPage === 'admin');

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-slate-50 pb-20 sm:pb-0 text-slate-900">
      {/* Header */}
      <nav className="bg-white/80 backdrop-blur-md border-b sticky top-0 z-50 px-4 h-16 flex items-center justify-between shadow-sm">
        <div onClick={() => setCurrentPage('home')} className="flex items-center gap-2 cursor-pointer">
          <div className="bg-emerald-500 p-1.5 rounded-lg text-white">
            <i className="fas fa-leaf"></i>
          </div>
          <span className="font-black text-xl tracking-tighter text-emerald-600">FRESHPRESS</span>
        </div>
        <div className="flex gap-4 items-center">
          {user ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-bold text-slate-600 hidden sm:inline-block">{user.displayName}</span>
              <button onClick={handleLogout} className="text-xs font-bold text-red-500 hover:text-red-600 transition-colors">LOGOUT</button>
            </div>
          ) : (
            <button onClick={handleLogin} className="text-xs font-bold text-emerald-600 hover:text-emerald-700 transition-colors">LOGIN</button>
          )}
          {isAdminUser && (
            <button onClick={() => setCurrentPage('admin')} className={`text-xs font-bold transition-colors ${currentPage === 'admin' ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}>ADMIN</button>
          )}
          <button onClick={() => setCurrentPage('cart')} className="relative bg-emerald-100 p-2.5 rounded-full text-emerald-600 hover:bg-emerald-200 transition-colors">
            <i className="fas fa-shopping-bag"></i>
            {cart.length > 0 && <span className="absolute -top-1 -right-1 bg-orange-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full ring-2 ring-white animate-pulse">{cart.length}</span>}
          </button>
        </div>
      </nav>

      {/* Pages */}
      <main className="max-w-4xl mx-auto p-4 sm:p-8">
        {currentPage === 'home' && (
          <div className="text-center py-20 space-y-8">
            <div className="relative inline-block">
               <img src="https://images.unsplash.com/photo-1610970881699-44a5587cabec?auto=format&fit=crop&q=80&w=600" className="w-64 h-64 rounded-full object-cover shadow-2xl border-8 border-white mx-auto" />
               <div className="absolute -bottom-4 -right-4 bg-orange-400 text-white p-4 rounded-full font-bold shadow-lg transform rotate-12">Fresh!</div>
            </div>
            <h1 className="text-5xl font-black text-slate-800 tracking-tight">Pure Juice. <br/>Pure Energy.</h1>
            <p className="text-slate-500 text-lg max-w-md mx-auto">Cold-pressed daily with local organic fruits. Order now for pickup or delivery.</p>
            <button onClick={() => setCurrentPage('menu')} className="bg-emerald-600 text-white px-10 py-5 rounded-3xl font-bold text-xl shadow-xl hover:scale-105 active:scale-95 transition-all">Start Your Order</button>
          </div>
        )}

        {currentPage === 'menu' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h2 className="text-3xl font-black text-slate-800">Fresh Menu</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {products.filter(p => p.available).map(p => (
                <div key={p.id} className="bg-white rounded-[2rem] p-5 shadow-sm border hover:shadow-md transition-shadow flex gap-4 items-center">
                  <img src={p.image} className="w-24 h-24 rounded-2xl object-cover" />
                  <div className="flex-1">
                    <div className="flex justify-between items-start">
                      <h3 className="font-bold text-lg text-slate-800">{p.name}</h3>
                      <span className="font-bold text-emerald-600">${p.price.toFixed(2)}</span>
                    </div>
                    <p className="text-xs text-slate-400 mb-3 line-clamp-2">{p.description}</p>
                    <button onClick={() => addToCart(p)} className="bg-emerald-50 text-emerald-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-600 hover:text-white transition-colors">Add to Cart</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {currentPage === 'cart' && (
          <div className="space-y-6 max-w-lg mx-auto animate-in fade-in duration-300">
            <h2 className="text-3xl font-black text-slate-800">My Bag</h2>
            {cart.length === 0 ? (
              <div className="text-center py-20 bg-white rounded-[2rem] border border-dashed text-slate-300">Your bag is empty.</div>
            ) : (
              <>
                <div className="space-y-3">
                  {cart.map(i => (
                    <div key={i.id} className="bg-white p-4 rounded-3xl flex items-center gap-4 shadow-sm">
                      <img src={i.image} className="w-16 h-16 rounded-xl object-cover" />
                      <div className="flex-1">
                        <div className="font-bold">{i.name}</div>
                        <div className="text-sm text-emerald-600 font-bold">${i.price.toFixed(2)}</div>
                      </div>
                      <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-2xl">
                        <button onClick={() => updateQuantity(i.id, -1)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200"><i className="fas fa-minus text-xs"></i></button>
                        <span className="font-bold">{i.quantity}</span>
                        <button onClick={() => updateQuantity(i.id, 1)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200"><i className="fas fa-plus text-xs"></i></button>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-4">
                  <div className="flex justify-between font-bold text-xl">
                    <span>Subtotal</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <button onClick={() => setCurrentPage('checkout')} className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-lg shadow-lg hover:bg-emerald-700 transition-colors">Checkout</button>
                </div>
              </>
            )}
          </div>
        )}

        {currentPage === 'checkout' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 animate-in slide-in-from-right-10 duration-500">
            <div className="space-y-6">
               <h2 className="text-3xl font-black text-slate-800">Checkout</h2>
               <div className="bg-white p-6 rounded-[2rem] shadow-sm border space-y-4">
                 <input value={customerName} onChange={e => setCustomerName(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500" placeholder="Your Name" />
                 <input value={phone} onChange={e => setPhone(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500" placeholder="Phone Number" />
                 <div className="grid grid-cols-2 gap-2">
                   <button onClick={() => setOrderType('Pickup')} className={`p-4 rounded-2xl font-bold border-2 transition-all ${orderType === 'Pickup' ? 'bg-emerald-50 border-emerald-500 text-emerald-600' : 'bg-slate-50 border-transparent text-slate-400'}`}>Pickup</button>
                   <button onClick={() => setOrderType('Delivery')} className={`p-4 rounded-2xl font-bold border-2 transition-all ${orderType === 'Delivery' ? 'bg-emerald-50 border-emerald-500 text-emerald-600' : 'bg-slate-50 border-transparent text-slate-400'}`}>Delivery</button>
                 </div>
                 {orderType === 'Delivery' && (
                   <textarea value={address} onChange={e => setAddress(e.target.value)} className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 h-24" placeholder="Delivery Address"></textarea>
                 )}
               </div>
            </div>
            
            <div className="space-y-6">
              <div className="bg-white p-6 rounded-[2rem] shadow-lg border-2 border-emerald-500 sticky top-24 space-y-6">
                <h3 className="font-black text-xl">Summary</h3>
                <div className="space-y-2 max-h-40 overflow-y-auto hide-scrollbar">
                  {cart.map(i => (
                    <div key={i.id} className="flex justify-between text-sm">
                      <span className="text-slate-500">{i.quantity}x {i.name}</span>
                      <span className="font-bold">${(i.price * i.quantity).toFixed(2)}</span>
                    </div>
                  ))}
                </div>
                
                {aiUpsell && (
                  <div className="bg-orange-50 p-4 rounded-2xl border border-orange-200 animate-pulse">
                    <div className="text-[10px] font-black text-orange-400 uppercase tracking-widest mb-1">AI Recommendation</div>
                    <div className="flex items-center gap-3">
                      <img src={aiUpsell.image} className="w-10 h-10 rounded-lg object-cover" />
                      <div className="flex-1">
                        <div className="text-xs font-bold text-orange-900">Add a {aiUpsell.name}?</div>
                        <button onClick={() => {addToCart(aiUpsell); setAiUpsell(null);}} className="text-[10px] bg-orange-500 text-white px-2 py-1 rounded-lg mt-1 font-bold">Add +${aiUpsell.price}</button>
                      </div>
                    </div>
                  </div>
                )}

                <div className="border-t pt-4 space-y-2">
                   <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                   {orderType === 'Delivery' && <div className="flex justify-between text-slate-500"><span>Delivery Fee</span><span>${DELIVERY_FEE.toFixed(2)}</span></div>}
                   <div className="flex justify-between font-black text-2xl pt-2"><span>Total</span><span>${total.toFixed(2)}</span></div>
                </div>
                <button disabled={isProcessing} onClick={handleCheckout} className="w-full bg-emerald-600 text-white py-5 rounded-2xl font-black text-xl hover:scale-105 transition-all flex justify-center items-center gap-2">
                  {isProcessing ? <i className="fas fa-spinner animate-spin"></i> : <><i className="fas fa-lock text-sm opacity-50"></i> Place Order</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {currentPage === 'confirmation' && (
          <div className="text-center py-20 animate-in zoom-in-95 duration-700">
             <div className="w-24 h-24 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-4xl mx-auto mb-6"><i className="fas fa-check-circle"></i></div>
             <h2 className="text-4xl font-black text-slate-800 mb-2">Order Confirmed!</h2>
             <p className="text-slate-500 mb-4 font-medium italic px-4">
               {aiConfirmationMessage || "Your fresh squeeze is being prepared!"}
             </p>
             <p className="text-slate-400 text-sm mb-8">Order ID: <span className="font-mono text-emerald-600 font-bold">#{lastOrder?.id}</span></p>
             <div className="bg-white p-6 rounded-[2rem] max-w-sm mx-auto shadow-sm border text-left space-y-2 mb-8">
                <div className="flex justify-between text-sm"><span>Customer</span><span className="font-bold">{lastOrder?.customerName}</span></div>
                <div className="flex justify-between text-sm"><span>Type</span><span className="font-bold text-orange-500 uppercase">{lastOrder?.type}</span></div>
                <div className="flex justify-between text-sm"><span>Ready In</span><span className="font-bold">20-30 Mins</span></div>
             </div>
             <button onClick={() => setCurrentPage('home')} className="text-emerald-600 font-bold underline">Back to Home</button>
          </div>
        )}

        {currentPage === 'admin' && (
          isAdminUser ? (
          <div className="space-y-12 pb-12">
            {/* Header / Global Actions */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <h2 className="text-3xl font-black text-slate-800">Shop Admin</h2>
              <div className="flex gap-2">
                <button 
                  onClick={enrichAllDescriptions}
                  disabled={isEnriching}
                  className="bg-orange-100 text-orange-600 px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-200 transition-all flex items-center gap-2"
                >
                  {isEnriching ? (
                    <><i className="fas fa-circle-notch animate-spin"></i> Enhancing...</>
                  ) : (
                    <><i className="fas fa-magic"></i> AI Enrich All Descriptions</>
                  )}
                </button>
                <button 
                  onClick={() => isAddingProduct ? closeForm() : setIsAddingProduct(true)}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-emerald-700 transition-all flex items-center gap-2 shadow-lg"
                >
                  <i className={`fas ${isAddingProduct ? 'fa-times' : 'fa-plus'}`}></i> 
                  {isAddingProduct ? 'Cancel Form' : 'Add New Juice'}
                </button>
              </div>
            </div>

            {/* Add/Edit Product Form */}
            {isAddingProduct && (
              <div className="bg-white p-8 rounded-[2rem] shadow-xl border-2 border-emerald-500 animate-in slide-in-from-top-4 duration-300">
                <h3 className="text-xl font-black text-slate-800 mb-6 flex items-center gap-2">
                  <i className={`fas ${editingProduct ? 'fa-edit' : 'fa-plus-circle'} text-emerald-500`}></i> 
                  {editingProduct ? `Modify: ${editingProduct.name}` : 'New Juice Listing'}
                </h3>

                {saveError && (
                  <div className="bg-red-50 border border-red-200 text-red-800 p-4 rounded-2xl mb-6 text-xs font-bold flex items-center gap-3">
                    <i className="fas fa-exclamation-circle text-lg"></i>
                    {saveError}
                  </div>
                )}

                <form onSubmit={handleSaveProduct} className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Product Name</label>
                      <input 
                        value={newProductName} 
                        onChange={e => setNewProductName(e.target.value)}
                        className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500" 
                        placeholder="e.g. Refreshing Watermelon" 
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Price ($)</label>
                      <input 
                        type="number" step="0.01"
                        value={newProductPrice} 
                        onChange={e => setNewProductPrice(e.target.value)}
                        className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500" 
                        placeholder="7.50" 
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Image URL</label>
                      <input 
                        value={newProductImage} 
                        onChange={e => setNewProductImage(e.target.value)}
                        className="w-full p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500" 
                        placeholder="https://images.unsplash.com/..." 
                      />
                    </div>
                    <div className="flex items-center gap-3 p-4 bg-emerald-50 rounded-2xl">
                      <input 
                        type="checkbox"
                        id="is_available"
                        checked={newProductAvailable}
                        onChange={e => setNewProductAvailable(e.target.checked)}
                        className="w-5 h-5 accent-emerald-600 rounded"
                      />
                      <label htmlFor="is_available" className="text-sm font-bold text-emerald-800 cursor-pointer">Available for Order</label>
                    </div>
                  </div>
                  <div className="space-y-4 flex flex-col">
                    <div className="flex-1">
                      <label className="text-xs font-bold text-slate-400 uppercase tracking-widest block mb-2">Ingredients (comma-separated)</label>
                      <textarea 
                        value={newProductIngredients} 
                        onChange={e => setNewProductIngredients(e.target.value)}
                        className="w-full h-40 p-4 bg-slate-50 border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 resize-none" 
                        placeholder="Apple, Lime, Mint, Ginger..." 
                      />
                    </div>
                    <div className="flex gap-3 mt-4">
                      <button 
                        type="button"
                        onClick={closeForm}
                        className="flex-1 bg-slate-100 text-slate-600 py-5 rounded-2xl font-black text-lg hover:bg-slate-200 transition-all shadow-sm"
                      >
                        Discard
                      </button>
                      <button 
                        type="submit" 
                        disabled={isCreatingProduct}
                        className="flex-[2] bg-emerald-600 text-white py-5 rounded-2xl font-black text-lg hover:bg-emerald-700 transition-all shadow-lg flex items-center justify-center gap-3 disabled:bg-slate-300"
                      >
                        {isCreatingProduct ? (
                          <><i className="fas fa-circle-notch animate-spin"></i> Processing...</>
                        ) : (
                          <><i className="fas fa-save"></i> {editingProduct ? 'Apply Changes' : 'Create Product'}</>
                        )}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            )}

            {/* Orders Management Section */}
            <div className="space-y-6">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <i className="fas fa-receipt text-emerald-500"></i> Active Orders
              </h3>
              <div className="grid grid-cols-1 gap-4">
                {orders.length === 0 ? (
                  <div className="text-center py-12 bg-white rounded-[2rem] text-slate-400 border border-dashed">No customer orders recorded yet.</div>
                ) : (
                  orders.map(o => (
                    <div key={o.id} className="bg-white p-6 rounded-[2rem] shadow-sm border flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-black">#{o.id}</span>
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${o.type === 'Delivery' ? 'bg-blue-100 text-blue-600' : 'bg-orange-100 text-orange-600'}`}>{o.type}</span>
                        </div>
                        <div className="text-sm font-bold text-slate-800">{o.customerName} • {o.phone}</div>
                        <div className="text-xs text-slate-400">{o.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}</div>
                      </div>
                      <div className="flex items-center gap-4 w-full sm:w-auto">
                        <select value={o.status} onChange={async (e) => {
                          const newStatus = e.target.value as OrderStatus;
                          try {
                            await updateDoc(doc(db, 'orders', o.id), { status: newStatus });
                          } catch (error) {
                            handleFirestoreError(error, OperationType.UPDATE, 'orders');
                          }
                        }} className="flex-1 sm:flex-none p-3 bg-slate-50 border-none rounded-xl text-sm font-bold">
                          <option value="New">New</option>
                          <option value="Preparing">Preparing</option>
                          <option value="Ready">Ready</option>
                          <option value="Completed">Completed</option>
                        </select>
                        <div className="font-black text-emerald-600 w-20 text-right">${o.total.toFixed(2)}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Inventory Management Section */}
            <div className="space-y-6">
              <h3 className="text-xl font-black text-slate-800 flex items-center gap-2">
                <i className="fas fa-warehouse text-emerald-500"></i> Product Catalog
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {products.map(p => (
                  <div key={p.id} className={`bg-white p-4 rounded-3xl shadow-sm border flex items-center gap-4 group transition-opacity ${p.available ? 'opacity-100' : 'opacity-60 bg-slate-100'}`}>
                    <img src={p.image} className="w-16 h-16 rounded-xl object-cover" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <div className="font-bold text-slate-800">{p.name}</div>
                        {!p.available && <span className="text-[8px] bg-slate-400 text-white px-1.5 py-0.5 rounded font-black uppercase">Out of Stock</span>}
                      </div>
                      <div className="text-xs text-slate-500">${p.price.toFixed(2)}</div>
                    </div>
                    <div className="flex gap-1">
                      <button 
                        onClick={() => handleEditProduct(p)}
                        className="text-slate-400 hover:text-emerald-600 p-2 transition-colors sm:opacity-0 group-hover:opacity-100"
                        title="Edit Details"
                      >
                        <i className="fas fa-edit"></i>
                      </button>
                      <button 
                        onClick={() => deleteProduct(p.id)}
                        className="text-slate-400 hover:text-red-500 p-2 transition-colors sm:opacity-0 group-hover:opacity-100"
                        title="Remove Item"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          ) : (
            <div className="text-center py-20 max-w-2xl mx-auto">
              <h2 className="text-3xl font-black text-slate-800 mb-4">Admin Access Required</h2>
              <p className="text-slate-500 mb-8">{user ? "You do not have permission to access the admin dashboard." : "Please login to access the admin dashboard."}</p>
              
              {authError === 'unauthorized-domain' && (
                <div className="bg-red-50 border border-red-200 text-red-800 p-6 rounded-2xl mb-8 text-left text-sm shadow-sm">
                  <h4 className="font-bold text-red-900 mb-3 text-base flex items-center gap-2">
                    <i className="fas fa-exclamation-triangle"></i> Login Error
                  </h4>
                  <p className="mb-3">This domain is not authorized for login. Please try again in a few moments as the configuration updates.</p>
                </div>
              )}

              <button onClick={handleLogin} className="bg-emerald-600 text-white px-8 py-4 rounded-2xl font-bold hover:bg-emerald-700 transition-colors shadow-lg flex items-center gap-3 mx-auto">
                <i className="fab fa-google"></i> Login with Google
              </button>
            </div>
          )
        )}
      </main>

      {/* Floating AI ChatBot */}
      <div className="fixed bottom-24 sm:bottom-8 right-4 sm:right-8 z-50">
        {isChatOpen ? (
          <div className="bg-white rounded-[2rem] shadow-2xl w-80 sm:w-96 flex flex-col overflow-hidden border border-emerald-100 animate-in slide-in-from-bottom-5 duration-300">
             <div className="bg-emerald-600 p-4 text-white flex justify-between items-center">
               <span className="font-black tracking-tight"><i className="fas fa-robot mr-2"></i> FRESHBOT</span>
               <button onClick={() => setIsChatOpen(false)}><i className="fas fa-times"></i></button>
             </div>
             <div className="h-64 overflow-y-auto p-4 space-y-3 bg-slate-50 hide-scrollbar">
               {chatMessages.length === 0 && <div className="text-center text-xs text-slate-400 py-10">Ask me anything about our juices!</div>}
               {chatMessages.map((m, idx) => (
                 <div key={idx} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                   <div className={`max-w-[80%] p-3 rounded-2xl text-xs font-medium ${m.role === 'user' ? 'bg-emerald-500 text-white rounded-br-none' : 'bg-white shadow-sm text-slate-700 rounded-bl-none'}`}>
                     {m.text}
                   </div>
                 </div>
               ))}
               {isChatLoading && <div className="flex justify-start"><div className="bg-white p-3 rounded-2xl rounded-bl-none shadow-sm animate-pulse text-[8px] text-slate-400">THINKING...</div></div>}
             </div>
             <div className="p-3 bg-white border-t flex gap-2">
               <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendChatMessage()} className="flex-1 p-3 bg-slate-50 rounded-xl text-xs focus:outline-none" placeholder="Type a message..." />
               <button onClick={sendChatMessage} className="bg-emerald-600 text-white w-10 h-10 rounded-xl flex items-center justify-center"><i className="fas fa-paper-plane text-xs"></i></button>
             </div>
          </div>
        ) : (
          <button onClick={() => setIsChatOpen(true)} className="bg-emerald-600 text-white w-14 h-14 rounded-full shadow-xl flex items-center justify-center hover:scale-110 transition-transform">
            <i className="fas fa-comment-dots text-xl"></i>
          </button>
        )}
      </div>

      {/* Mobile Nav */}
      <div className="sm:hidden fixed bottom-0 left-0 right-0 bg-white border-t px-6 h-16 flex items-center justify-between z-40">
        <button onClick={() => setCurrentPage('home')} className={`flex flex-col items-center gap-1 ${currentPage === 'home' ? 'text-emerald-600' : 'text-slate-400'}`}><i className="fas fa-home text-lg"></i><span className="text-[8px] font-black uppercase tracking-widest">Home</span></button>
        <button onClick={() => setCurrentPage('menu')} className={`flex flex-col items-center gap-1 ${currentPage === 'menu' ? 'text-emerald-600' : 'text-slate-400'}`}><i className="fas fa-search text-lg"></i><span className="text-[8px] font-black uppercase tracking-widest">Menu</span></button>
        <button onClick={() => setCurrentPage('cart')} className={`flex flex-col items-center gap-1 ${currentPage === 'cart' || currentPage === 'checkout' ? 'text-emerald-600' : 'text-slate-400'}`}><i className="fas fa-shopping-bag text-lg"></i><span className="text-[8px] font-black uppercase tracking-widest">Bag</span></button>
        <button onClick={() => setCurrentPage('admin')} className={`flex flex-col items-center gap-1 ${currentPage === 'admin' ? 'text-emerald-600' : 'text-slate-400'}`}><i className="fas fa-cog text-lg"></i><span className="text-[8px] font-black uppercase tracking-widest">Admin</span></button>
      </div>
    </div>
    </ErrorBoundary>
  );
};

export default App;
