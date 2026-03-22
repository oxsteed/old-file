import { useEffect, useState, useCallback } from 'react';
import { MapPin, Plus, X, Loader2 } from 'lucide-react';
import adminApi from '../../lib/adminApi';
import toast from 'react-hot-toast';

export default function MarketZipCodes() {
  const [markets, setMarkets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [newZips, setNewZips] = useState({});
  const [adding, setAdding] = useState({});

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/admin/markets');
      setMarkets(data.markets || []);
    } catch (err) {
      toast.error('Failed to load markets');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMarkets(); }, [fetchMarkets]);

  const handleAddZips = async (marketId) => {
    const raw = (newZips[marketId] || '').trim();
    if (!raw) return;
    const zips = raw.split(/[,\s]+/).map(z => z.trim()).filter(Boolean);
    const invalid = zips.filter(z => !/^\d{5}$/.test(z));
    if (invalid.length) {
      toast.error(`Invalid zip codes: ${invalid.join(', ')}`);
      return;
    }
    setAdding(p => ({ ...p, [marketId]: true }));
    try {
      const { data } = await adminApi.post(`/admin/markets/${marketId}/zip-codes`, { zipCodes: zips });
      setMarkets(prev => prev.map(m => m.id === marketId ? data.market : m));
      setNewZips(p => ({ ...p, [marketId]: '' }));
      toast.success(`Added ${zips.length} zip code(s)`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to add zip codes');
    } finally {
      setAdding(p => ({ ...p, [marketId]: false }));
    }
  };

  const handleRemoveZip = async (marketId, zip) => {
    try {
      const { data } = await adminApi.delete(`/admin/markets/${marketId}/zip-codes`, {
        data: { zipCodes: [zip] }
      });
      setMarkets(prev => prev.map(m => m.id === marketId ? data.market : m));
      toast.success(`Removed ${zip}`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to remove zip code');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-orange-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <MapPin className="w-6 h-6 text-orange-500" />
        <h1 className="text-2xl font-bold text-white">Market Zip Codes</h1>
      </div>

      {markets.map(market => (
        <div key={market.id} className="bg-zinc-900 rounded-xl border border-zinc-800 p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-semibold text-white">
                {market.name}, {market.state}
              </h2>
              <p className="text-sm text-zinc-400">
                {market.active ? 'Active' : 'Inactive'} &middot; {market.zipcodes?.length || 0} zip codes
              </p>
            </div>
          </div>

          {/* Current zip codes */}
          <div className="flex flex-wrap gap-2 mb-4">
            {(market.zipcodes || []).sort().map(zip => (
              <span key={zip} className="inline-flex items-center gap-1 px-3 py-1
                bg-zinc-800 text-zinc-200 rounded-full text-sm border border-zinc-700">
                {zip}
                <button
                  onClick={() => handleRemoveZip(market.id, zip)}
                  className="ml-1 text-zinc-500 hover:text-red-400 transition-colors"
                  title={`Remove ${zip}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>

          {/* Add zip codes */}
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Enter zip codes (comma or space separated)"
              value={newZips[market.id] || ''}
              onChange={e => setNewZips(p => ({ ...p, [market.id]: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && handleAddZips(market.id)}
              className="flex-1 px-4 py-2 bg-zinc-800 border border-zinc-700
                rounded-lg text-white placeholder-zinc-500 focus:outline-none
                focus:border-orange-500 focus:ring-1 focus:ring-orange-500"
            />
            <button
              onClick={() => handleAddZips(market.id)}
              disabled={adding[market.id] || !(newZips[market.id] || '').trim()}
              className="px-4 py-2 bg-orange-600 text-white rounded-lg
                hover:bg-orange-500 disabled:opacity-50 disabled:cursor-not-allowed
                flex items-center gap-2 transition-colors"
            >
              {adding[market.id]
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Plus className="w-4 h-4" />}
              Add
            </button>
          </div>
        </div>
      ))}

      {markets.length === 0 && (
        <div className="text-center py-12 text-zinc-500">
          No markets found. Create a market first.
        </div>
      )}
    </div>
  );
}
