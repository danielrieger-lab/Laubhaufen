import { useEffect, useMemo, useState, type FormEvent, type KeyboardEvent } from 'react';
import {
  deleteRecipe,
  deletePantryItem,
  deleteShoppingItem,
  deleteWeeklyMeal,
  getFirebaseServices,
  subscribeToPantryItems,
  seedIfEmpty,
  subscribeToRecipes,
  subscribeToShoppingItems,
  subscribeToWeeklyMeals,
  upsertRecipe,
  upsertPantryItem,
  upsertShoppingItem,
  upsertWeeklyMeal
} from './lib/firebase';
import {
  createRecipe,
  createShoppingItem,
  createWeeklyMeal,
  createId,
  dayLabel,
  getMondayForDate,
  parseTags,
  loadAppState,
  nextCheckState,
  saveAppState,
  slotLabel,
} from './lib/storage';
import type { DayKey, MealSlot, PantryItem, Recipe, ShoppingItem, WeeklyMeal } from './lib/types';

const dayOrder: DayKey[] = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
const mealSlots: MealSlot[] = ['breakfast', 'lunch', 'dinner'];
const starterRecipeIds = ['starter-overnight-oats', 'starter-vegetable-pasta', 'starter-sheet-pan-tacos'];
const starterMealIds = ['starter-monday-breakfast', 'starter-monday-dinner', 'starter-wednesday-lunch'];
const starterShoppingIds = ['starter-shopping-oats', 'starter-shopping-pasta', 'starter-shopping-tortillas'];

type MultiValueFieldProps = {
  label: string;
  values: string[];
  suggestions?: string[];
  listId?: string;
  placeholder: string;
  onChange: (values: string[]) => void;
};

function MultiValueField({ label, values, suggestions = [], listId, placeholder, onChange }: MultiValueFieldProps) {
  const [input, setInput] = useState('');

  function addValues(value: string): void {
    const nextValues = parseTags(value);
    if (nextValues.length === 0) {
      return;
    }

    const existing = new Set(values.map((entry) => entry.toLocaleLowerCase('de-DE')));
    onChange([...values, ...nextValues.filter((entry) => !existing.has(entry.toLocaleLowerCase('de-DE')))]);
    setInput('');
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addValues(input);
    }
  }

  return (
    <label className="multi-value-field">
      {label}
      <div className="multi-value-input">
        <div className="multi-value-chips">
          {values.map((value) => (
            <span className="multi-value-chip" key={value}>
              {value}
              <button type="button" onClick={() => onChange(values.filter((entry) => entry !== value))} aria-label={`${value} entfernen`}>×</button>
            </span>
          ))}
        </div>
        <input
          list={listId}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => addValues(input)}
          placeholder={values.length === 0 ? placeholder : 'Weitere hinzufügen'}
        />
      </div>
      {listId ? <datalist id={listId}>{suggestions.map((suggestion) => <option key={suggestion} value={suggestion} />)}</datalist> : null}
    </label>
  );
}

function App() {
  const persisted = loadAppState();
  const firebase = useMemo(() => getFirebaseServices(), []);
  const currentWeekStart = useMemo(() => getMondayForDate(new Date()), []);

  const [recipes, setRecipes] = useState<Recipe[]>(() => (persisted?.recipes ?? []).filter((recipe) => !starterRecipeIds.includes(recipe.id)));
  const [weeklyMeals, setWeeklyMeals] = useState<WeeklyMeal[]>(() => (persisted?.weeklyMeals ?? []).filter((meal) => !starterMealIds.includes(meal.id)));
  const [shoppingItems, setShoppingItems] = useState<ShoppingItem[]>(() => (persisted?.shoppingItems ?? []).filter((item) => !starterShoppingIds.includes(item.id)));
  const [pantryItems, setPantryItems] = useState<PantryItem[]>(persisted?.pantryItems ?? []);
  const [activeTab, setActiveTab] = useState<'recipes' | 'week' | 'shopping' | 'pantry' | null>(null);
  const [selectedRecipeTag, setSelectedRecipeTag] = useState('');
  const [selectedRecipeCountry, setSelectedRecipeCountry] = useState('');
  const [selectedRecipeSeason, setSelectedRecipeSeason] = useState('');
  const [viewingRecipe, setViewingRecipe] = useState<Recipe | null>(null);
  const [syncStatus, setSyncStatus] = useState(firebase ? 'Gemeinsame Synchronisierung wird verbunden ...' : 'Lokaler Modus');
  const [recipeDraft, setRecipeDraft] = useState({ title: '', tags: [] as string[], countries: [] as string[], seasons: [] as string[], ingredients: [] as string[], instructions: [] as string[], link: '' });
  const [editingRecipeId, setEditingRecipeId] = useState<string | null>(null);
  const [editingRecipe, setEditingRecipe] = useState<Recipe | null>(null);
  const [editingPantryId, setEditingPantryId] = useState<string | null>(null);
  const [editingPantry, setEditingPantry] = useState<PantryItem | null>(null);
  const [slotInputs, setSlotInputs] = useState<Record<string, string>>({});
  const [shoppingDraft, setShoppingDraft] = useState({ name: '', quantity: '1', unit: 'Stück' });
  const [pantryDraft, setPantryDraft] = useState({ name: '', quantity: '1', unit: 'Stück' });

  useEffect(() => {
    saveAppState({ recipes, weeklyMeals, shoppingItems, pantryItems });
  }, [recipes, weeklyMeals, shoppingItems, pantryItems]);

  useEffect(() => {
    if (!firebase) {
      return;
    }

    let cancelled = false;
    let unsubscribeRecipes: (() => void) | undefined;
    let unsubscribeMeals: (() => void) | undefined;
    let unsubscribeShopping: (() => void) | undefined;
    let unsubscribePantry: (() => void) | undefined;

    void firebase.authReady
      .then(async () => {
        if (cancelled) {
          return;
        }

        const handleSyncError = () => setSyncStatus('Synchronisierung nicht verfügbar');

        await Promise.all([
          ...starterRecipeIds.map((recipeId) => deleteRecipe(firebase.db, recipeId)),
          ...starterMealIds.map((mealId) => deleteWeeklyMeal(firebase.db, mealId)),
          ...starterShoppingIds.map((itemId) => deleteShoppingItem(firebase.db, itemId))
        ]);

        unsubscribeRecipes = subscribeToRecipes(firebase.db, (items) => setRecipes(items.filter((recipe) => !starterRecipeIds.includes(recipe.id))), handleSyncError);
        unsubscribeMeals = subscribeToWeeklyMeals(firebase.db, (items) => setWeeklyMeals(items.filter((meal) => !starterMealIds.includes(meal.id))), handleSyncError);
        unsubscribeShopping = subscribeToShoppingItems(firebase.db, (items) => {
          setShoppingItems(items.filter((item) => !starterShoppingIds.includes(item.id)));
          setSyncStatus('Gemeinsame Synchronisierung aktiv');
        }, handleSyncError);
        unsubscribePantry = subscribeToPantryItems(firebase.db, setPantryItems, handleSyncError);

        await seedIfEmpty(firebase.db, {
          recipes,
          weeklyMeals,
          shoppingItems,
          pantryItems
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
      unsubscribePantry?.();
    };
  }, [firebase]);

  const weekMeals = useMemo(() => weeklyMeals.filter((meal) => meal.weekStart === currentWeekStart), [currentWeekStart, weeklyMeals]);
  const checkedCount = shoppingItems.filter((item) => item.checked).length;
  const availableTags = useMemo(() => Array.from(new Set(recipes.flatMap((recipe) => recipe.tags ?? []))).sort((a, b) => a.localeCompare(b, 'de-DE')), [recipes]);
  const availableCountries = useMemo(() => Array.from(new Set(recipes.flatMap((recipe) => recipe.countries ?? []))).sort((a, b) => a.localeCompare(b, 'de-DE')), [recipes]);
  const availableSeasons = useMemo(() => Array.from(new Set(recipes.flatMap((recipe) => recipe.seasons ?? []))).sort((a, b) => a.localeCompare(b, 'de-DE')), [recipes]);
  const filteredRecipes = useMemo(() => {
    if (!selectedRecipeTag && !selectedRecipeCountry && !selectedRecipeSeason) {
      return recipes;
    }

    return recipes.filter((recipe) => {
      const matchesTag = !selectedRecipeTag || recipe.tags.some((tag) => tag.toLocaleLowerCase('de-DE') === selectedRecipeTag.toLocaleLowerCase('de-DE'));
      const matchesCountry = !selectedRecipeCountry || recipe.countries.some((country) => country.toLocaleLowerCase('de-DE') === selectedRecipeCountry.toLocaleLowerCase('de-DE'));
      const matchesSeason = !selectedRecipeSeason || recipe.seasons.some((season) => season.toLocaleLowerCase('de-DE') === selectedRecipeSeason.toLocaleLowerCase('de-DE'));
      return matchesTag && matchesCountry && matchesSeason;
    });
  }, [recipes, selectedRecipeCountry, selectedRecipeSeason, selectedRecipeTag]);

  function recipeAvailability(recipe: Recipe | undefined): 'complete' | 'partial' | 'missing' {
    if (!recipe || recipe.ingredients.length === 0) {
      return 'complete';
    }

    const pantryNames = new Set(pantryItems.map((item) => item.name.trim().toLocaleLowerCase('de-DE')));
    const availableCount = recipe.ingredients.filter((ingredient) => pantryNames.has(ingredient.trim().toLocaleLowerCase('de-DE'))).length;
    const ratio = availableCount / recipe.ingredients.length;

    return ratio >= 1 ? 'complete' : ratio >= 0.5 ? 'partial' : 'missing';
  }

  function handleRecipeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!recipeDraft.title.trim()) {
      return;
    }

    const recipe = createRecipe({
      title: recipeDraft.title.trim(),
      tags: recipeDraft.tags,
      countries: recipeDraft.countries,
      seasons: recipeDraft.seasons,
      ingredients: recipeDraft.ingredients,
      instructions: recipeDraft.instructions,
      link: recipeDraft.link.trim()
    });

    setRecipes((current) => [recipe, ...current]);
    setRecipeDraft({ title: '', tags: [], countries: [], seasons: [], ingredients: [], instructions: [], link: '' });

    if (firebase) {
      void upsertRecipe(firebase.db, recipe).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function startEditingRecipe(recipe: Recipe): void {
    setEditingRecipeId(recipe.id);
    setEditingRecipe({ ...recipe, tags: recipe.tags ?? [], countries: recipe.countries ?? [], seasons: recipe.seasons ?? [], ingredients: recipe.ingredients ?? [], instructions: recipe.instructions ?? [], link: recipe.link ?? '' });
  }

  function cancelEditingRecipe(): void {
    setEditingRecipeId(null);
    setEditingRecipe(null);
  }

  function saveEditedRecipe(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!editingRecipe || !editingRecipe.title.trim()) {
      return;
    }

    const nextRecipe = { ...editingRecipe, title: editingRecipe.title.trim(), updatedAt: Date.now() };
    setRecipes((current) => current.map((recipe) => (recipe.id === nextRecipe.id ? nextRecipe : recipe)));
    cancelEditingRecipe();

    if (firebase) {
      void upsertRecipe(firebase.db, nextRecipe).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removeRecipe(recipe: Recipe): void {
    if (typeof window !== 'undefined' && !window.confirm(`„${recipe.title}“ wirklich löschen?`)) {
      return;
    }

    setRecipes((current) => current.filter((entry) => entry.id !== recipe.id));

    if (firebase) {
      void deleteRecipe(firebase.db, recipe.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function setMealForSlot(day: DayKey, slot: MealSlot, recipeTitle: string): void {
    const slotKey = `${day}-${slot}`;
    setSlotInputs((current) => ({ ...current, [slotKey]: recipeTitle }));
    const recipe = recipes.find((entry) => entry.title === recipeTitle.trim());
    const existingMeal = weekMeals.find((entry) => entry.day === day && entry.slot === slot);

    if (!recipe) {
      if (!recipeTitle.trim() && existingMeal) {
        setWeeklyMeals((current) => current.filter((entry) => entry.id !== existingMeal.id));
        if (firebase) {
          void deleteWeeklyMeal(firebase.db, existingMeal.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
        }
      }
      return;
    }

    const meal = createWeeklyMeal({
      weekStart: currentWeekStart,
      day,
      slot,
      recipeId: recipe.id,
      recipeTitle: recipe.title,
      note: ''
    });

    setWeeklyMeals((current) => [
      ...current.filter((entry) => !(entry.weekStart === currentWeekStart && entry.day === day && entry.slot === slot)),
      meal
    ]);

    if (firebase) {
      void upsertWeeklyMeal(firebase.db, meal).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }

    addRecipeIngredientsToShopping(recipe);
  }

  function addRecipeIngredientsToShopping(recipe: Recipe): void {
    const existingNames = new Set(shoppingItems.map((item) => item.name.trim().toLocaleLowerCase('de-DE')));
    const newItems = recipe.ingredients
      .map((ingredient) => ingredient.trim())
      .filter((ingredient) => ingredient && !existingNames.has(ingredient.toLocaleLowerCase('de-DE')))
      .map((ingredient) => createShoppingItem({
        name: ingredient,
        quantity: 1,
        unit: 'Stück',
        aisle: 'Allgemein'
      }));

    if (newItems.length === 0) {
      return;
    }

    setShoppingItems((current) => [
      ...newItems.filter((item) => !current.some((entry) => entry.name.toLocaleLowerCase('de-DE') === item.name.toLocaleLowerCase('de-DE'))),
      ...current
    ]);

    if (firebase) {
      void Promise.all(newItems.map((item) => upsertShoppingItem(firebase.db, item))).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function toggleShoppingItem(item: ShoppingItem): void {
    if (!item.checked) {
      const existingPantry = pantryItems.find((entry) => entry.name.trim().toLocaleLowerCase('de-DE') === item.name.trim().toLocaleLowerCase('de-DE'));
      const pantryItem: PantryItem = existingPantry
        ? { ...existingPantry, quantity: existingPantry.quantity + item.quantity, updatedAt: Date.now() }
        : { id: item.id, name: item.name, quantity: item.quantity, unit: item.unit, createdAt: Date.now(), updatedAt: Date.now() };

      setPantryItems((current) => existingPantry
        ? current.map((entry) => (entry.id === existingPantry.id ? pantryItem : entry))
        : [pantryItem, ...current]);
      setShoppingItems((current) => current.filter((entry) => entry.id !== item.id));

      if (firebase) {
        void upsertPantryItem(firebase.db, pantryItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
        void deleteShoppingItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
      }
      return;
    }

    const nextItem = { ...item, checked: nextCheckState(item.checked), updatedAt: Date.now() };
    setShoppingItems((current) => current.map((entry) => (entry.id === item.id ? nextItem : entry)));

    if (firebase) {
      void upsertShoppingItem(firebase.db, nextItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removeShoppingItem(item: ShoppingItem): void {
    setShoppingItems((current) => current.filter((entry) => entry.id !== item.id));

    if (firebase) {
      void deleteShoppingItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function removePantryItem(item: PantryItem): void {
    setPantryItems((current) => current.filter((entry) => entry.id !== item.id));

    if (firebase) {
      void deletePantryItem(firebase.db, item.id).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function addShoppingItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!shoppingDraft.name.trim()) {
      return;
    }

    const item = createShoppingItem({
      name: shoppingDraft.name.trim(),
      quantity: Math.max(0, Number(shoppingDraft.quantity) || 1),
      unit: shoppingDraft.unit.trim() || 'Stück',
      aisle: 'Manuell'
    });

    setShoppingItems((current) => [item, ...current]);
    setShoppingDraft({ name: '', quantity: '1', unit: 'Stück' });

    if (firebase) {
      void upsertShoppingItem(firebase.db, item).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function addPantryItem(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!pantryDraft.name.trim()) {
      return;
    }

    const normalizedName = pantryDraft.name.trim().toLocaleLowerCase('de-DE');
    const existingItem = pantryItems.find((item) => item.name.trim().toLocaleLowerCase('de-DE') === normalizedName);
    const item: PantryItem = existingItem
      ? { ...existingItem, quantity: existingItem.quantity + Math.max(0, Number(pantryDraft.quantity) || 1), unit: pantryDraft.unit.trim() || existingItem.unit, updatedAt: Date.now() }
      : { id: createId(), name: pantryDraft.name.trim(), quantity: Math.max(0, Number(pantryDraft.quantity) || 1), unit: pantryDraft.unit.trim() || 'Stück', createdAt: Date.now(), updatedAt: Date.now() };

    setPantryItems((current) => existingItem
      ? current.map((entry) => (entry.id === existingItem.id ? item : entry))
      : [item, ...current]);
    setPantryDraft({ name: '', quantity: '1', unit: 'Stück' });

    if (firebase) {
      void upsertPantryItem(firebase.db, item).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  function startEditingPantry(item: PantryItem): void {
    setEditingPantryId(item.id);
    setEditingPantry({ ...item });
  }

  function cancelEditingPantry(): void {
    setEditingPantryId(null);
    setEditingPantry(null);
  }

  function saveEditedPantry(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();

    if (!editingPantry || !editingPantry.name.trim() || editingPantry.quantity < 0) {
      return;
    }

    const nextItem = {
      ...editingPantry,
      name: editingPantry.name.trim(),
      unit: editingPantry.unit.trim() || 'Stück',
      updatedAt: Date.now()
    };

    setPantryItems((current) => current.map((item) => (item.id === nextItem.id ? nextItem : item)));
    cancelEditingPantry();

    if (firebase) {
      void upsertPantryItem(firebase.db, nextItem).catch(() => setSyncStatus('Synchronisierung nicht verfügbar'));
    }
  }

  return (
    <main className="app-shell">
      {activeTab === null ? (
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
      ) : null}

      {activeTab === 'recipes' ? (
        <section className="recipe-window" aria-labelledby="recipes-title">
          <div className="recipe-window-heading">
            <div>
              <p className="eyebrow recipe-window-eyebrow">Rezepte</p>
              <h2 id="recipes-title">Alle Rezepte</h2>
            </div>
            <div className="recipe-window-controls">
              <label>
                Tag filtern
                <select value={selectedRecipeTag} onChange={(event) => setSelectedRecipeTag(event.target.value)}>
                  <option value="">Alle Tags</option>
                  {availableTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
              </label>
              <label>
                Land filtern
                <select value={selectedRecipeCountry} onChange={(event) => setSelectedRecipeCountry(event.target.value)}>
                  <option value="">Alle Länder</option>
                  {availableCountries.map((country) => <option key={country} value={country}>{country}</option>)}
                </select>
              </label>
              <label>
                Season filtern
                <select value={selectedRecipeSeason} onChange={(event) => setSelectedRecipeSeason(event.target.value)}>
                  <option value="">Alle Seasons</option>
                  {availableSeasons.map((season) => <option key={season} value={season}>{season}</option>)}
                </select>
              </label>
              <span className="recipe-count">{filteredRecipes.length} von {recipes.length}</span>
            </div>
          </div>

          <div className="recipe-window-grid">
            <form className="composer-card recipe-form" onSubmit={handleRecipeSubmit}>
              <div className="card-heading">
                <h3>Neues Rezept</h3>
                <p>Lege ein Rezept für die gemeinsame Sammlung an.</p>
              </div>

              <label>
                Titel
                <input value={recipeDraft.title} onChange={(event) => setRecipeDraft((current) => ({ ...current, title: event.target.value }))} placeholder="Name des Rezepts" required />
              </label>

              <MultiValueField label="Tags" values={recipeDraft.tags} suggestions={availableTags} listId="recipe-tags" placeholder="z. B. schnell, vegetarisch" onChange={(tags) => setRecipeDraft((current) => ({ ...current, tags }))} />
              <MultiValueField label="Land" values={recipeDraft.countries} suggestions={availableCountries} listId="recipe-countries" placeholder="z. B. Italien, Japan" onChange={(countries) => setRecipeDraft((current) => ({ ...current, countries }))} />
              <MultiValueField label="Season" values={recipeDraft.seasons} suggestions={availableSeasons} listId="recipe-seasons" placeholder="z. B. Frühling, Winter" onChange={(seasons) => setRecipeDraft((current) => ({ ...current, seasons }))} />
              <MultiValueField label="Zutaten" values={recipeDraft.ingredients} placeholder="Zutat hinzufügen" onChange={(ingredients) => setRecipeDraft((current) => ({ ...current, ingredients }))} />
              <MultiValueField label="Zubereitung" values={recipeDraft.instructions} placeholder="Schritt hinzufügen" onChange={(instructions) => setRecipeDraft((current) => ({ ...current, instructions }))} />

              <label>
                Link
                <input value={recipeDraft.link} onChange={(event) => setRecipeDraft((current) => ({ ...current, link: event.target.value }))} placeholder="https://..." type="url" />
              </label>

              <button type="submit">Rezept anlegen</button>
            </form>

            {viewingRecipe ? (
              <section className="recipe-view-panel" aria-labelledby="recipe-view-title">
                <div className="recipe-view-heading">
                  <div>
                    <p className="eyebrow recipe-window-eyebrow">Rezept ansehen</p>
                    <h3 id="recipe-view-title">{viewingRecipe.title}</h3>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => setViewingRecipe(null)}>Schließen</button>
                </div>
                {(viewingRecipe.tags ?? []).length > 0 ? <div className="recipe-tags">{viewingRecipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                {(viewingRecipe.countries ?? []).length > 0 ? <div className="recipe-tags"><strong>Land</strong>{viewingRecipe.countries.map((country) => <span key={country}>{country}</span>)}</div> : null}
                {(viewingRecipe.seasons ?? []).length > 0 ? <div className="recipe-tags"><strong>Season</strong>{viewingRecipe.seasons.map((season) => <span key={season}>{season}</span>)}</div> : null}
                <div className="recipe-view-columns">
                  <div>
                    <h4>Zutaten</h4>
                    <ul>{viewingRecipe.ingredients.map((ingredient) => <li key={ingredient}>{ingredient}</li>)}</ul>
                  </div>
                  <div>
                    <h4>Zubereitung</h4>
                    <ol>{(viewingRecipe.instructions ?? []).map((instruction) => <li key={instruction}>{instruction}</li>)}</ol>
                  </div>
                </div>
                {viewingRecipe.link ? <a className="recipe-view-link" href={viewingRecipe.link} target="_blank" rel="noreferrer">Link öffnen</a> : null}
              </section>
            ) : null}

            <div className="recipe-list" aria-label="Vorhandene Rezepte">
              {filteredRecipes.map((recipe) => (
                <article className="recipe-summary" key={recipe.id}>
                  {editingRecipeId === recipe.id && editingRecipe ? (
                    <form className="recipe-edit-form" onSubmit={saveEditedRecipe}>
                      <h3>Rezept bearbeiten</h3>
                      <label>
                        Titel
                        <input value={editingRecipe.title} onChange={(event) => setEditingRecipe((current) => current ? { ...current, title: event.target.value } : current)} required />
                      </label>
                      <MultiValueField label="Tags" values={editingRecipe.tags ?? []} suggestions={availableTags} listId={`recipe-tags-edit-${editingRecipe.id}`} placeholder="z. B. schnell, vegetarisch" onChange={(tags) => setEditingRecipe((current) => current ? { ...current, tags } : current)} />
                      <MultiValueField label="Land" values={editingRecipe.countries ?? []} suggestions={availableCountries} listId={`recipe-countries-edit-${editingRecipe.id}`} placeholder="z. B. Italien, Japan" onChange={(countries) => setEditingRecipe((current) => current ? { ...current, countries } : current)} />
                      <MultiValueField label="Season" values={editingRecipe.seasons ?? []} suggestions={availableSeasons} listId={`recipe-seasons-edit-${editingRecipe.id}`} placeholder="z. B. Frühling, Winter" onChange={(seasons) => setEditingRecipe((current) => current ? { ...current, seasons } : current)} />
                      <MultiValueField label="Zutaten" values={editingRecipe.ingredients} placeholder="Zutat hinzufügen" onChange={(ingredients) => setEditingRecipe((current) => current ? { ...current, ingredients } : current)} />
                      <MultiValueField label="Zubereitung" values={editingRecipe.instructions ?? []} placeholder="Schritt hinzufügen" onChange={(instructions) => setEditingRecipe((current) => current ? { ...current, instructions } : current)} />
                      <label>
                        Link
                        <input type="url" value={editingRecipe.link ?? ''} onChange={(event) => setEditingRecipe((current) => current ? { ...current, link: event.target.value } : current)} placeholder="https://..." />
                      </label>
                      <div className="recipe-actions">
                        <button type="submit">Änderungen speichern</button>
                        <button type="button" className="button-secondary" onClick={cancelEditingRecipe}>Abbrechen</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <div className="recipe-summary-heading">
                        <h3>{recipe.title}</h3>
                        <span>{(recipe.tags ?? []).length} Tags</span>
                      </div>
                      {(recipe.tags ?? []).length > 0 ? <div className="recipe-tags">{recipe.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}
                      {(recipe.countries ?? []).length > 0 ? <div className="recipe-tags"><strong>Land</strong>{recipe.countries.map((country) => <span key={country}>{country}</span>)}</div> : null}
                      {(recipe.seasons ?? []).length > 0 ? <div className="recipe-tags"><strong>Season</strong>{recipe.seasons.map((season) => <span key={season}>{season}</span>)}</div> : null}
                      <div className="recipe-summary-columns">
                        <div>
                          <strong>Zutaten</strong>
                          <span>{recipe.ingredients.length} Zutaten</span>
                        </div>
                        <div>
                          <strong>Zubereitung</strong>
                          <span>{(recipe.instructions ?? []).length} Schritte</span>
                        </div>
                        <div>
                          <strong>Link</strong>
                          {recipe.link ? <a href={recipe.link} target="_blank" rel="noreferrer">Öffnen</a> : <span>Kein Link</span>}
                        </div>
                      </div>
                      <div className="recipe-actions">
                        <button type="button" onClick={() => setViewingRecipe(recipe)}>Ansehen</button>
                        <button type="button" onClick={() => startEditingRecipe(recipe)}>Bearbeiten</button>
                        <button type="button" className="button-danger" onClick={() => removeRecipe(recipe)}>Löschen</button>
                      </div>
                    </>
                  )}
                </article>
              ))}
              {filteredRecipes.length === 0 ? <p className="recipe-empty">Keine Rezepte mit diesem Tag.</p> : null}
            </div>
          </div>
        </section>
      ) : null}

      {activeTab === 'week' ? (
        <section className="week-window" aria-labelledby="week-title">
          <div className="week-window-heading">
            <div>
              <p className="eyebrow week-window-eyebrow">Wochenplan</p>
              <h2 id="week-title">Diese Woche</h2>
            </div>
            <span>Woche ab {currentWeekStart}</span>
          </div>

          <div className="schedule-table" role="table" aria-label="Wochenplan">
            <div className="schedule-row schedule-header" role="row">
              <div className="schedule-slot-cell" role="columnheader">Mahlzeit</div>
              {dayOrder.map((day) => (
                <div className="schedule-day-cell" key={day} role="columnheader">{dayLabel(day)}</div>
              ))}
            </div>

            {mealSlots.map((slot) => (
              <div className="schedule-row" key={slot} role="row">
                <div className="schedule-slot-cell" role="rowheader">{slotLabel(slot)}</div>
                {dayOrder.map((day) => {
                  const meal = weekMeals.find((entry) => entry.day === day && entry.slot === slot);

                  return (
                    <div className={`schedule-meal-cell ${meal ? `has-meal recipe-${recipeAvailability(recipes.find((recipe) => recipe.id === meal.recipeId) ?? recipes[0])}` : ''}`} key={slot} role="cell">
                      <select
                        className="slot-recipe-field"
                        value={slotInputs[`${day}-${slot}`] ?? meal?.recipeTitle ?? ''}
                        onChange={(event) => setMealForSlot(day, slot, event.target.value)}
                        aria-label={`${dayLabel(day)} ${slotLabel(slot)} Rezept`}
                      >
                        <option value="">Rezept auswählen ...</option>
                        {recipes.map((recipe) => <option className={`recipe-option-${recipeAvailability(recipe)}`} key={recipe.id} value={recipe.title}>{recipe.title}</option>)}
                      </select>
                      {!meal ? <span className="schedule-empty">Noch nicht geplant</span> : null}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {activeTab === 'shopping' ? (
        <section className="shopping-window" aria-labelledby="shopping-title">
          <div className="shopping-window-heading">
            <div>
              <p className="eyebrow shopping-window-eyebrow">Einkaufsliste</p>
              <h2 id="shopping-title">Benötigte Zutaten</h2>
            </div>
            <span>{checkedCount} von {shoppingItems.length} erledigt</span>
          </div>

          <form className="manual-item-form" onSubmit={addShoppingItem}>
            <input value={shoppingDraft.name} onChange={(event) => setShoppingDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Zutat" aria-label="Zutat" required />
            <input value={shoppingDraft.quantity} onChange={(event) => setShoppingDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="0" step="any" placeholder="Menge" aria-label="Menge" required />
            <input value={shoppingDraft.unit} onChange={(event) => setShoppingDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="Einheit" aria-label="Einheit" />
            <button type="submit">Zutat hinzufügen</button>
          </form>

          <div className="shopping-list" aria-label="Einkaufsartikel">
            {shoppingItems.length === 0 ? (
              <p className="shopping-empty">Noch keine Zutaten auf der Einkaufsliste.</p>
            ) : (
              shoppingItems.map((item) => (
                <div className={item.checked ? 'shopping-item checked' : 'shopping-item'} key={item.id}>
                  <label className="shopping-item-main">
                    <input type="checkbox" checked={item.checked} onChange={() => toggleShoppingItem(item)} />
                    <span>{item.name}</span>
                  </label>
                  <span className="shopping-item-meta">{item.quantity} {item.unit}</span>
                  <button type="button" className="button-danger shopping-delete" onClick={() => removeShoppingItem(item)} aria-label={`${item.name} löschen`}>Löschen</button>
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      {activeTab === 'pantry' ? (
        <section className="shopping-window" aria-labelledby="pantry-title">
          <div className="shopping-window-heading">
            <div>
              <p className="eyebrow shopping-window-eyebrow">Vorratskammer</p>
              <h2 id="pantry-title">Vorhandene Zutaten</h2>
            </div>
            <span>{pantryItems.length} Zutaten vorhanden</span>
          </div>

          <form className="manual-item-form" onSubmit={addPantryItem}>
            <input value={pantryDraft.name} onChange={(event) => setPantryDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Zutat" aria-label="Zutat" required />
            <input value={pantryDraft.quantity} onChange={(event) => setPantryDraft((current) => ({ ...current, quantity: event.target.value }))} type="number" min="0" step="any" placeholder="Menge" aria-label="Menge" required />
            <input value={pantryDraft.unit} onChange={(event) => setPantryDraft((current) => ({ ...current, unit: event.target.value }))} placeholder="Einheit" aria-label="Einheit" />
            <button type="submit">Zutat hinzufügen</button>
          </form>

          <div className="shopping-list" aria-label="Vorratskammer">
            {pantryItems.length === 0 ? (
              <p className="shopping-empty">Noch keine Zutaten in der Vorratskammer.</p>
            ) : (
              pantryItems.map((item) => (
                <div className="shopping-item" key={item.id}>
                  {editingPantryId === item.id && editingPantry ? (
                    <form className="pantry-edit-form" onSubmit={saveEditedPantry}>
                      <label>
                        Zutat
                        <input value={editingPantry.name} onChange={(event) => setEditingPantry((current) => current ? { ...current, name: event.target.value } : current)} required />
                      </label>
                      <label>
                        Menge
                        <input type="number" min="0" step="any" value={editingPantry.quantity} onChange={(event) => setEditingPantry((current) => current ? { ...current, quantity: Number(event.target.value) } : current)} required />
                      </label>
                      <label>
                        Einheit
                        <input value={editingPantry.unit} onChange={(event) => setEditingPantry((current) => current ? { ...current, unit: event.target.value } : current)} placeholder="Stück, Packung ..." />
                      </label>
                      <div className="recipe-actions">
                        <button type="submit">Speichern</button>
                        <button type="button" className="button-secondary" onClick={cancelEditingPantry}>Abbrechen</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <span className="shopping-item-main">{item.name}</span>
                      <span className="shopping-item-meta">{item.quantity} {item.unit}</span>
                      <div className="shopping-item-actions">
                        <button type="button" onClick={() => startEditingPantry(item)} aria-label={`${item.name} bearbeiten`}>Bearbeiten</button>
                        <button type="button" className="button-danger" onClick={() => removePantryItem(item)} aria-label={`${item.name} aus der Vorratskammer löschen`}>Löschen</button>
                      </div>
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      ) : null}

      <nav className="feature-nav" aria-label="Bereiche">
        <button className={activeTab === 'recipes' ? 'feature-button active' : 'feature-button'} onClick={() => setActiveTab('recipes')} type="button" aria-label="Rezepte" title="Rezepte">
          <svg className="feature-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3v7" /><path d="M4.5 3v4.5a2.5 2.5 0 0 0 5 0V3" /><path d="M7 10v11" /><path d="M16 3v18" /><path d="M16 3c2.2 1.4 3.5 3.5 3.5 6H16" /></svg>
        </button>
        <button className={activeTab === 'week' ? 'feature-button active' : 'feature-button'} onClick={() => setActiveTab('week')} type="button" aria-label="Speiseplan" title="Speiseplan">
          <svg className="feature-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M7 2.5v4M17 2.5v4M3 9h18M7 13h.01M12 13h.01M17 13h.01M7 17h.01M12 17h.01" /></svg>
        </button>
        <button className={activeTab === 'shopping' ? 'feature-button active' : 'feature-button'} onClick={() => setActiveTab('shopping')} type="button" aria-label="Einkaufsliste" title="Einkaufsliste">
          <svg className="feature-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 4h2l2.2 10.2a2 2 0 0 0 2 1.6h7.6a2 2 0 0 0 1.9-1.4L20 8H6" /><circle cx="9" cy="19" r="1.3" /><circle cx="18" cy="19" r="1.3" /></svg>
        </button>
        <button className={activeTab === 'pantry' ? 'feature-button active' : 'feature-button'} onClick={() => setActiveTab('pantry')} type="button" aria-label="Vorratskammer" title="Vorratskammer">
          <svg className="feature-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h16l-1.2 10.5H5.2L4 9Z" /><path d="M6 9a6 6 0 0 1 12 0M8 12v4M12 12v4M16 12v4" /></svg>
        </button>
      </nav>

    </main>
  );
}

export default App;
