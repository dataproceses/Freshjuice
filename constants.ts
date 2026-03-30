
import { Product } from './types';

export const INITIAL_PRODUCTS: Product[] = [
  {
    id: '1',
    name: 'Green Glow',
    price: 8.50,
    image: 'https://images.unsplash.com/photo-1610970881699-44a5587cabec?auto=format&fit=crop&q=80&w=400',
    available: true,
    ingredients: ['Kale', 'Cucumber', 'Green Apple', 'Lemon', 'Ginger'],
    description: 'A refreshing mix of greens to kickstart your morning with high antioxidants.'
  },
  {
    id: '2',
    name: 'Citrus Surge',
    price: 7.95,
    image: 'https://images.unsplash.com/photo-1622597467836-f30a588374f1?auto=format&fit=crop&q=80&w=400',
    available: true,
    ingredients: ['Orange', 'Grapefruit', 'Turmeric', 'Black Pepper'],
    description: 'Immunity boosting citrus blend with a hint of anti-inflammatory turmeric.'
  },
  {
    id: '3',
    name: 'Beet Blast',
    price: 9.00,
    image: 'https://images.unsplash.com/photo-1595981267035-7b04ca84a82d?auto=format&fit=crop&q=80&w=400',
    available: true,
    ingredients: ['Beetroot', 'Carrot', 'Red Apple', 'Lime'],
    description: 'Earthly beets combined with sweet carrots for the ultimate stamina booster.'
  },
  {
    id: '4',
    name: 'Berry Revive',
    price: 10.50,
    image: 'https://images.unsplash.com/photo-1570197788417-0e82375c9371?auto=format&fit=crop&q=80&w=400',
    available: true,
    ingredients: ['Blueberry', 'Strawberry', 'Coconut Water', 'Chia Seeds'],
    description: 'Antioxidant-rich berries blended with hydrating coconut water.'
  }
];

export const DELIVERY_FEE = 3.50;
