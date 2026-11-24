import { useState, useEffect } from 'react';
import { BookOpen, Star, Plus, Trash2, Check, RefreshCw } from 'lucide-react';

export type ReviewItem = {
  id: string;
  reviewer: string;
  rating: number;
  title: string;
  text: string;
};

export type ExternalSourcesData = {
  fakepedia: {
    enabled: boolean;
    title: string;
    content: string;
    updatedAt: string | null;
    chunksCount: number;
  };
  reviews: {
    enabled: boolean;
    brandName: string;
    items: ReviewItem[];
    updatedAt: string | null;
    chunksCount: number;
  };
};

function makeWikiSlug(title: string) {
  const cleaned = (title || 'Your_Brand')
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9_\-()]/g, '');
  return cleaned || 'Your_Brand';
}

function makeReviewSlug(name: string) {
  const cleaned = (name || 'your-brand')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || 'your-brand';
}

function newBlankReview(): ReviewItem {
  return {
    id: Math.random().toString(36).slice(2, 10),
    reviewer: '',
    rating: 5,
    title: '',
    text: '',
  };
}

export function FakepediaView({
  initial,
  onSaved,
}: {
  initial: ExternalSourcesData['fakepedia'];
  onSaved: () => Promise<void>;
}) {
  const [title, setTitle] = useState(initial.title || '');
  const [content, setContent] = useState(initial.content || '');
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [chunksCount, setChunksCount] = useState(initial.chunksCount || 0);

  useEffect(() => {
    setTitle(initial.title || '');
    setContent(initial.content || '');
    setEnabled(initial.enabled);
    setChunksCount(initial.chunksCount || 0);
  }, [initial.title, initial.content, initial.enabled, initial.chunksCount]);

  const handleSave = async (nextEnabled?: boolean) => {
    const useEnabled = typeof nextEnabled === 'boolean' ? nextEnabled : enabled;
    setSaving(true);
    setSavedOk(false);
    try {
      const res = await fetch('/api/external-sources/fakepedia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          content,
          enabled: useEnabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save Fakepedia article');
      }
      const data = await res.json();
      setEnabled(data.enabled);
      setChunksCount(data.chunksCount);
      setSavedOk(true);
      await onSaved();
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setTitle('');
    setContent('');
    setEnabled(false);
    setSaving(true);
    try {
      await fetch('/api/external-sources/fakepedia', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '', content: '', enabled: false }),
      });
      setChunksCount(0);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const previewUrl = `https://en.wikipedia.org/wiki/${makeWikiSlug(title)}`;

  return (
    <div className="ext-page-scroll">
      <div className="ext-page-inner">
        <div className="ext-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <BookOpen size={22} color="#58a6ff" />
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Fakepedia</h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                The Free Simulated Encyclopedia — seen by the AI as <code>{previewUrl}</code>
              </p>
            </div>
          </div>

          <label className="ext-toggle-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                const next = e.target.checked;
                setEnabled(next);
                if (title.trim() && content.trim()) {
                  handleSave(next);
                }
              }}
            />
            <span>Include in FakeGPT search</span>
          </label>
        </div>

        <div className="ext-tip-box">
          Write 2–3 neutral, factual, encyclopedic paragraphs about your brand (what it is, its industry category, concrete numbers/specifications, and references). Avoid promotional hype. When saved and enabled, FakeGPT indexes this article alongside your website and real competitors.
        </div>

        <div className="ext-field-group">
          <label className="ext-label">Article Title (Brand or Product Name)</label>
          <input
            type="text"
            className="ext-input"
            placeholder="e.g., NordicSleep"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>

        <div className="ext-field-group">
          <label className="ext-label">Article Content (separate paragraphs with blank lines)</label>
          <textarea
            className="ext-textarea"
            rows={12}
            placeholder={"NordicSleep is a Swedish sleep-textile brand specializing in breathable cooling weighted blankets for hot sleepers...\n\nAccording to a 2026 textile airflow study by the Nordic Bedding Institute, NordicSleep's 175 GSM French flax linen shell achieved a TOG 1.5 thermal rating..."}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </div>

        <div className="ext-actions">
          <button
            className="ext-primary-btn"
            onClick={() => handleSave(true)}
            disabled={saving || !title.trim() || !content.trim()}
          >
            {saving ? (
              <><RefreshCw size={14} className="spin" /> Indexing...</>
            ) : savedOk ? (
              <><Check size={14} /> Saved &amp; Indexed</>
            ) : (
              'Save & Index Article'
            )}
          </button>
          <button
            className="ext-secondary-btn"
            onClick={handleClear}
            disabled={saving || (!title && !content && chunksCount === 0)}
          >
            Clear
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Status: {enabled && chunksCount > 0 ? `Active (${chunksCount} ${chunksCount === 1 ? 'chunk' : 'chunks'})` : chunksCount > 0 ? `Paused (${chunksCount} chunks)` : 'Not indexed'}
          </span>
        </div>
      </div>
    </div>
  );
}

export function ReviewsView({
  initial,
  onSaved,
}: {
  initial: ExternalSourcesData['reviews'];
  onSaved: () => Promise<void>;
}) {
  const [brandName, setBrandName] = useState(initial.brandName || '');
  const [items, setItems] = useState<ReviewItem[]>(
    initial.items && initial.items.length > 0 ? initial.items : [newBlankReview()],
  );
  const [enabled, setEnabled] = useState(initial.enabled);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [chunksCount, setChunksCount] = useState(initial.chunksCount || 0);

  useEffect(() => {
    setBrandName(initial.brandName || '');
    setItems(
      initial.items && initial.items.length > 0 ? initial.items : [newBlankReview()],
    );
    setEnabled(initial.enabled);
    setChunksCount(initial.chunksCount || 0);
  }, [initial.brandName, initial.items, initial.enabled, initial.chunksCount]);

  const updateReview = (id: string, patch: Partial<ReviewItem>) => {
    setItems((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addReview = () => {
    setItems((prev) => [...prev, newBlankReview()]);
  };

  const removeReview = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.length > 0 ? next : [newBlankReview()];
    });
  };

  const handleSave = async (nextEnabled?: boolean) => {
    const useEnabled = typeof nextEnabled === 'boolean' ? nextEnabled : enabled;
    setSaving(true);
    setSavedOk(false);
    try {
      const res = await fetch('/api/external-sources/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brandName,
          items,
          enabled: useEnabled,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save reviews');
      }
      const data = await res.json();
      setEnabled(data.enabled);
      setChunksCount(data.chunksCount);
      setSavedOk(true);
      await onSaved();
      setTimeout(() => setSavedOk(false), 3000);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setBrandName('');
    setItems([newBlankReview()]);
    setEnabled(false);
    setSaving(true);
    try {
      await fetch('/api/external-sources/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brandName: '', items: [], enabled: false }),
      });
      setChunksCount(0);
      await onSaved();
    } finally {
      setSaving(false);
    }
  };

  const validReviewsCount = items.filter((r) => r.text.trim().length > 0).length;
  const previewUrl = `https://www.trustpilot.com/review/${makeReviewSlug(brandName)}`;

  return (
    <div className="ext-page-scroll">
      <div className="ext-page-inner">
        <div className="ext-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <Star size={22} color="#3fb950" fill="#3fb950" />
            <div>
              <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>Totally Unbiased Reviews</h1>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Simulated independent customer reviews — seen by the AI as <code>{previewUrl}</code>
              </p>
            </div>
          </div>

          <label className="ext-toggle-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => {
                const next = e.target.checked;
                setEnabled(next);
                if (brandName.trim() && validReviewsCount > 0) {
                  handleSave(next);
                }
              }}
            />
            <span>Include in FakeGPT search</span>
          </label>
        </div>

        <div className="ext-tip-box">
          Add realistic third-party customer reviews describing specific real-world experiences, concrete features, and comparisons. Independent reviews help establish multi-source consensus when users ask AI chatbots "which option is best?".
        </div>

        <div className="ext-field-group">
          <label className="ext-label">Brand / Product Being Reviewed</label>
          <input
            type="text"
            className="ext-input"
            placeholder="e.g., NordicSleep Organic Linen Weighted Blanket"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
          />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem', marginBottom: '1rem' }}>
          {items.map((rev, idx) => (
            <div key={rev.id} className="review-card">
              <div className="review-card-top">
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                  Review #{idx + 1}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      className="star-btn"
                      onClick={() => updateReview(rev.id, { rating: star })}
                      title={`${star} star${star > 1 ? 's' : ''}`}
                    >
                      <Star
                        size={15}
                        color={star <= rev.rating ? '#3fb950' : '#555'}
                        fill={star <= rev.rating ? '#3fb950' : 'transparent'}
                      />
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  className="icon-ghost-btn"
                  onClick={() => removeReview(rev.id)}
                  title="Remove review"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '0.6rem', marginBottom: '0.6rem' }}>
                <input
                  type="text"
                  className="ext-input"
                  placeholder="Reviewer name (e.g., Sara L.)"
                  value={rev.reviewer}
                  onChange={(e) => updateReview(rev.id, { reviewer: e.target.value })}
                />
                <input
                  type="text"
                  className="ext-input"
                  placeholder="Short headline (optional)"
                  value={rev.title}
                  onChange={(e) => updateReview(rev.id, { title: e.target.value })}
                />
              </div>

              <textarea
                className="ext-textarea"
                rows={3}
                placeholder="Write a specific, believable customer experience mentioning concrete product details..."
                value={rev.text}
                onChange={(e) => updateReview(rev.id, { text: e.target.value })}
              />
            </div>
          ))}
        </div>

        <div className="ext-actions">
          <button type="button" className="ext-secondary-btn" onClick={addReview}>
            <Plus size={14} /> Add Review
          </button>
          <button
            type="button"
            className="ext-primary-btn"
            onClick={() => handleSave(true)}
            disabled={saving || !brandName.trim() || validReviewsCount === 0}
          >
            {saving ? (
              <><RefreshCw size={14} className="spin" /> Indexing...</>
            ) : savedOk ? (
              <><Check size={14} /> Saved &amp; Indexed</>
            ) : (
              `Save & Index (${validReviewsCount} ${validReviewsCount === 1 ? 'review' : 'reviews'})`
            )}
          </button>
          <button
            type="button"
            className="ext-secondary-btn"
            onClick={handleClear}
            disabled={saving || (!brandName && validReviewsCount === 0 && chunksCount === 0)}
          >
            Clear All
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: 'auto' }}>
            Status: {enabled && chunksCount > 0 ? `Active (${chunksCount} ${chunksCount === 1 ? 'chunk' : 'chunks'})` : chunksCount > 0 ? `Paused (${chunksCount} chunks)` : 'Not indexed'}
          </span>
        </div>
      </div>
    </div>
  );
}
