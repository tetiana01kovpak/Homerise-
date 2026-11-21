// The 10 reference inputs used to test generation end to end (offline generator + Claude path).
export interface ExamplePrompt { id: string; title: string; prompt: string; expect: { bedrooms: number; bathroomsMin: number; levels: number; area: [number, number]; garage?: boolean; basement?: boolean; roof?: 'gable' | 'hip' | 'flat' | 'shed' } }

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  { id: 'studio', title: 'City studio', prompt: 'Compact studio apartment with an open kitchen', expect: { area: [25, 50], bedrooms: 0, bathroomsMin: 1, levels: 1, roof: 'flat' } },
  { id: 'apt2', title: '2-bed apartment', prompt: 'Bright 2 bedroom apartment with open plan living and a balcony', expect: { area: [55, 100], bedrooms: 2, bathroomsMin: 1, levels: 1, roof: 'flat' } },
  { id: 'bungalow', title: 'Family bungalow', prompt: '3 bedroom 2 bath bungalow with a gable roof, garage and a patio', expect: { area: [110, 200], bedrooms: 3, bathroomsMin: 2, levels: 1, garage: true, roof: 'gable' } },
  { id: 'modern2', title: 'Modern two-storey', prompt: 'Modern two story house, 4 bedrooms, 3 bathrooms, home office, double garage, flat roof', expect: { area: [200, 340], bedrooms: 4, bathroomsMin: 3, levels: 2, garage: true, roof: 'flat' } },
  { id: 'farmhouse', title: 'Farmhouse', prompt: 'Farmhouse with 4 bedrooms, 2.5 baths, open kitchen, laundry, walk-in closet and a big porch', expect: { area: [190, 320], bedrooms: 4, bathroomsMin: 2, levels: 2, roof: 'gable' } },
  { id: 'villa', title: 'Mediterranean villa', prompt: 'Mediterranean villa with hipped roof, 5 bedrooms, 4 bathrooms, pool and terrace, 2 floors', expect: { area: [250, 420], bedrooms: 5, bathroomsMin: 4, levels: 2, roof: 'hip' } },
  { id: 'basement', title: 'House with basement', prompt: 'Two storey 3 bedroom family home with a basement gym, 2 bathrooms and a single garage', expect: { area: [160, 300], bedrooms: 3, bathroomsMin: 2, levels: 3, basement: true, garage: true } },
  { id: 'tiny', title: 'Tiny cabin', prompt: 'Tiny 1 bedroom scandinavian cabin, 45 m2, steep gable roof', expect: { area: [35, 60], bedrooms: 1, bathroomsMin: 1, levels: 1, roof: 'gable' } },
  { id: 'townhouse', title: 'Townhouse', prompt: '3 storey townhouse with 3 bedrooms, 2 bathrooms, powder room and a roof terrace feel, shed roof', expect: { area: [140, 260], bedrooms: 3, bathroomsMin: 2, levels: 3, roof: 'shed' } },
  { id: 'large', title: 'Large family home', prompt: 'Large 6 bedroom contemporary family home, 4 bathrooms, office, double garage, basement cinema, 350 m2', expect: { area: [300, 430], bedrooms: 6, bathroomsMin: 4, levels: 3, garage: true, basement: true } },
];
