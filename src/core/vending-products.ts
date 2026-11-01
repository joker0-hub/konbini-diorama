/** Shared catalogue: the machine display, shopping panel and dispensed bottles agree. */
export type VendingVariant = 'blue' | 'red';

export interface Drink {
  id: string;
  name: string;
  label: string;
  price: number;
  color: string;
  capColor?: string;
}

export const VENDING_DRINKS: readonly Drink[] = [
  { id: 'water', name: '山泉水', label: '水', price: 120, color: '#65b5d4', capColor: '#e9f4f5' },
  { id: 'tea', name: '清香绿茶', label: '茶', price: 150, color: '#71a672', capColor: '#e8ead5' },
  { id: 'ramune', name: '波子汽水', label: 'ラムネ', price: 150, color: '#668dcc', capColor: '#eef2f7' },
  { id: 'peach', name: '白桃果饮', label: '桃', price: 160, color: '#dc8c9f', capColor: '#f7e4df' },
  { id: 'coffee', name: '牛乳咖啡', label: '珈琲', price: 180, color: '#a17b58', capColor: '#503a32' },
  { id: 'orange', name: '鲜橙果汁', label: '橙', price: 160, color: '#e1a348', capColor: '#f5e6c8' },
];
