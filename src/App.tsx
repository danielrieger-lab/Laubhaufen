import { useEffect, useMemo, useState } from 'react';
import {
  getFirebaseServices,
  seedIfEmpty,
  subscribeToRecipes,
  subscribeToShoppingItems,
  subscribeToWeeklyMeals
} from './lib/firebase';
import {
  getMondayForDate,
  loadAppState,
  saveAppState,
} from './lib/storage';
import type { Recipe, ShoppingItem, WeeklyMeal } from './lib/types';

function createStarterRecipes(): Recipe[] {
  const now = Date.now();

  return [
    {
      id: 'starter-overnight-oats',
      title: 'Overnight Oats',
      servings: 4,
      prepTimeMinutes: 10,
      ingredients: ['Haferflocken', 'Milch oder Pflanzenmilch', 'Joghurt', 'Beeren', 'Honig'],
      instructions: ['Haferflocken und Flüssigkeit mischen.', 'Über Nacht kalt stellen.', 'Vor dem Servieren mit Beeren garnieren.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-vegetable-pasta',
      title: 'Gemüsepasta',
      servings: 4,
      prepTimeMinutes: 25,
      ingredients: ['Nudeln', 'Zucchini', 'Tomaten', 'Olivenöl', 'Knoblauch'],
      instructions: ['Nudeln kochen.', 'Gemüse anbraten.', 'Alles vermengen und abschmecken.'],
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-sheet-pan-tacos',
      title: 'Tacos vom Blech',
      servings: 4,
      prepTimeMinutes: 35,
      ingredients: ['Tortillas', 'Bohnen', 'Paprika', 'Zwiebel', 'Salsa'],
      instructions: ['Füllung rösten.', 'Tortillas erwärmen.', 'Mit Salsa und Toppings anrichten.'],
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createStarterMeals(weekStart: string): WeeklyMeal[] {
  const now = Date.now();

  return [
    {
      id: 'starter-monday-breakfast',
      weekStart,
      day: 'monday',
      slot: 'breakfast',
      recipeId: 'starter-overnight-oats',
      recipeTitle: 'Overnight Oats',
      note: 'Ein einfacher Start in die Woche.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-monday-dinner',
      weekStart,
      day: 'monday',
      slot: 'dinner',
      recipeId: 'starter-vegetable-pasta',
      recipeTitle: 'Gemüsepasta',
      note: 'Übrig gebliebenes Gemüse verwenden.',
      createdAt: now,
      updatedAt: now
    },
    {
      id: 'starter-wednesday-lunch',
      weekStart,
      day: 'wednesday',
      slot: 'lunch',
      recipeId: 'starter-sheet-pan-tacos',
      recipeTitle: 'Tacos vom Blech',
      note: 'Ideal für ein schnelles Mittagessen.',
      createdAt: now,
      updatedAt: now
    }
  ];
}

function createStarterShopping(): ShoppingItem[] {
  const now = Date.now();

  return [
    { id: 'starter-shopping-oats', name: 'Haferflocken', quantity: 1, unit: 'Packung', aisle: 'Frühstück', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-pasta', name: 'Nudeln', quantity: 2, unit: 'Packungen', aisle: 'Trockenvorräte', checked: false, createdAt: now, updatedAt: now },
    { id: 'starter-shopping-tortillas', name: 'Tortillas', quantity: 1, unit: 'Packung', aisle: 'Backwaren', checked: false, createdAt: now, updatedAt: now }
  ];
}

function App() {
  const persisted = loadAppState();
  const firebase = useMemo(() => getFirebaseServices(), []);
  const currentWeekStart = useMemo(() => getMondayForDate(new Date()), []);

  const starterRecipes = useMemo(() => createStarterRecipes(), []);
  const starterMeals = useMemo(() => createStarterMeals(currentWeekStart), [currentWeekStart]);
  const starterShopping = useMemo(() => createStarterShopping(), []);

  const [recipes, setRecipes] = useState<Recipe[]>(persisted?.recipes ?? starterRecipes);
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>(persisted?.weeklyMeals ?? starterMeals);
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(persisted?.shoppingItems ?? starterShopping);
  const [activeTab, setActiveTab] = useState<'recipes' | 'week' | 'shopping'>('recipes');
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Gemeinsame Synchronisierung wird verbunden ...' : 'Lokaler Modus');

  useEffect(() => {
    saveAppState({ recipes, weeklyMeals, shoppingItems });
  }, [recipes, weeklyMeals, shoppingItems]);

  useEffect(() => {
    if (!firebase) {
      return;
    }

    let cancelled = false;
    let unsubscribeRecipes: (() => void) | undefined;
    let unsubscribeMeals: (() => void) | undefined;
    let unsubscribeShopping: (() => void) | undefined;

    void firebase.authReady
      .then(async () => {
        if (cancelled) {
          return;
        }

        unsubscribeRecipes = subscribeToRecipes(firebase.db, setRecipes);
        unsubscribeMeals = subscribeToWeeklyMeals(firebase.db, setWeeklyMeals);
        unsubscribeShopping = subscribeToShoppingItems(firebase.db, (items) => {
          setShoppingItems(items);
          setSyncStatus('Gemeinsame Synchronisierung aktiv');
        });

        await seedIfEmpty(firebase.db, {
          recipes: recipes.length > 0 ? recipes : starterRecipes,
          weeklyMeals: weeklyMeals.length > 0 ? weeklyMeals : starterMeals,
          shoppingItems: shoppingItems.length > 0 ? shoppingItems : starterShopping
        });
      })
      .catch(() => {
        if (!cancelled) {
          setSyncStatus('Synchronisierung nicht verfügbar');
        }
      });

    return () => {
      cancelled = true;
      unsubscribeRecipes?.();
      unsubscribeMeals?.();
      unsubscribeShopping?.();
    };
  }, [firebase]);

  const weekMeals = useMemo(() => weeklyMeals.filter((meal) => meal.weekStart === currentWeekStart), [currentWeekStart, weeklyMeals]);
  const checkedCount = shoppingItems.filter((item) => item.checked).length;

  return (
    <main className="app-shell">
      <section className="hero-card hero-card--wide">
        <div className="hero-copy">
          <p className="eyebrow">Laubhaufen</p>

          <div className="hero-meta">
            <span>{syncStatus}</span>
            <span>{recipes.length} Rezepte</span>
            <span>{weekMeals.length} geplante Mahlzeiten</span>
            <span>{shoppingItems.length} Einkaufsartikel</span>
          </div>
        </div>

        <div className="stats-grid stats-grid--wide">
          <article>
            <strong>{recipes.length}</strong>
            <span>Rezepte</span>
          </article>
          <article>
            <strong>{weekMeals.length}</strong>
            <span>Mahlzeiten diese Woche</span>
          </article>
          <article>
            <strong>{shoppingItems.length}</strong>
            <span>Einkaufsartikel</span>
          </article>
          <article>
            <strong>{checkedCount}</strong>
            <span>Erledigt</span>
          </article>
        </div>
      </section>

      <nav className="tab-bar" aria-label="Bereiche">
        <button className={activeTab === 'recipes' ? 'tab active' : 'tab'} onClick={() => setActiveTab('recipes')} type="button">
          Rezepte
        </button>
        <button className={activeTab === 'week' ? 'tab active' : 'tab'} onClick={() => setActiveTab('week')} type="button">
          Wochenplan
        </button>
        <button className={activeTab === 'shopping' ? 'tab active' : 'tab'} onClick={() => setActiveTab('shopping')} type="button">
          Einkaufsliste
        </button>
      </nav>

    </main>
  );
}

export default App;
