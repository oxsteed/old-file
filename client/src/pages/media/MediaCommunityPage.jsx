import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, MapPin, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getCommunity, joinCommunity, leaveCommunity } from '../../api/media';
import { useAuth } from '../../context/AuthContext';
import MediaPostCard from './MediaPostCard';

export default function MediaCommunityPage() {
  const { t } = useTranslation();
  const { slug } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getCommunity(slug));
      setError(null);
    } catch (err) {
      setError(err.response?.data?.error || t('media.spaces.loadError'));
    } finally {
      setLoading(false);
    }
  }, [slug, t]);

  useEffect(() => { void load(); }, [load]);

  const toggleMembership = async () => {
    if (!data?.community || !user) return;
    setSaving(true);
    try {
      const result = data.community.joined
        ? await leaveCommunity(data.community.id)
        : await joinCommunity(data.community.id);
      setData((current) => ({
        ...current,
        community: { ...current.community, joined: result.joined },
      }));
    } catch (err) {
      setError(err.response?.data?.error || t('media.spaces.membershipError'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="media-empty-state"><p>{t('media.spaces.loading')}</p></div>;
  if (error || !data?.community) {
    return <div className="media-error"><p>{error || t('media.spaces.notFound')}</p><button type="button" onClick={load}>{t('media.feed.refresh')}</button></div>;
  }

  const { community, posts } = data;
  return (
    <div className="media-community-page">
      <header className="media-community-detail-header">
        <Link to="/media/communities" className="media-back-link"><ArrowLeft size={16} aria-hidden="true" />{t('media.spaces.back')}</Link>
        <div className="media-community-detail-title">
          <span className="media-community-detail-icon"><Users size={22} aria-hidden="true" /></span>
          <div>
            <p className="media-page-kicker"><MapPin size={14} aria-hidden="true" />{t('media.spaces.kicker')}</p>
            <h1>{community.title}</h1>
            <p>{[community.geo_scope, community.category, t('media.spaces.members', { count: community.member_count || 0 })].filter(Boolean).join(' · ')}</p>
          </div>
        </div>
        {user ? (
          <button type="button" className="media-text-button" onClick={toggleMembership} disabled={saving}>
            {community.joined ? t('media.spaces.leave') : t('media.spaces.join')}
          </button>
        ) : (
          <Link to="/login" className="media-text-button">{t('media.spaces.signInToJoin')}</Link>
        )}
      </header>
      <div className="media-community-posts">
        {posts?.length ? posts.map((post) => <MediaPostCard key={post.id} post={post} />) : (
          <div className="media-empty-state"><h2>{t('media.spaces.emptyHeading')}</h2><p>{t('media.spaces.emptyDescription')}</p></div>
        )}
      </div>
    </div>
  );
}
