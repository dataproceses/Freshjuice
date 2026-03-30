
export interface Product {
  id: string;
  name: string;
  price: number;
  image: string;
  description?: string;
  available: boolean;
  ingredients: string[];
}

export interface CartItem extends Product {
  quantity: number;
}

export type OrderType = 'Pickup' | 'Delivery';

export type OrderStatus = 'New' | 'Preparing' | 'Ready' | 'Completed';

export interface Order {
  id: string;
  customerName: string;
  phone: string;
  items: CartItem[];
  total: number;
  type: OrderType;
  address?: string;
  status: OrderStatus;
  createdAt: number;
  uid?: string;
}

export type Page = 'home' | 'menu' | 'cart' | 'checkout' | 'confirmation' | 'admin';
