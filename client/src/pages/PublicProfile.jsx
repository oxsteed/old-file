import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import api from '../api/axios';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function PublicProfile() {
  const { id } = useParams();
  const [profile, setProfile] = useState(null);
  const [reviews, setReviews] = useState([]);
  const [badges, setBadges] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [profileRes, reviewsRes, badgesRes] = await Promise.all([
          api.get(`/users/${id}/profile`),
          api.get(`/reviews/users/${id}`),
          api.get(`/verification/badges/${id}`),
        ]);
        setProfile(profileRes.data);
        setReviews(reviewsRes.data.reviews || []);
        setBadges(badgesRes.data.badges || []);
      } catch (err) {
        console.error('Failed to load profile', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Loading profile...</p></div>;
  if (!profile) return <div className="min-h-screen bg-gray-950 flex items-center justify-center"><p className="text-gray-400">Profile not found.</p></div>;

  const avgRating = reviews.length
    ? (reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length).toFixed(1)
    : 'No ratings';

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 py-12">
        {/* Profile Header */}
        <div className="bg-gray-900 rounded-xl p-8 border border-gray-800">
          <div className="flex items-start gap-6">
            <div className="w-24 h-24 rounded-full bg-orange-600 flex items-center justify-center text-3xl font-bold">
              {profile.first_name?.[0]}{profile.last_name?.[0]}
            </div>
            <div className="flex-1">
              <h1 className="text-2xl font-bold">{profile.first_name} {profile.last_name?.[0]}.</h1>
              <p className="text-gray-400 mt-1">
                {(profile.city && profile.state)
                  ? `${profile.city}, ${profile.state}`
                  : (profile.zip_code || profile.zipcode || 'Location unavailable')}
                {' '}&middot; Member since {new Date(profile.created_at).getFullYear()}
              </p>
              <div className="flex gap-2 mt-3 flex-wrap">
                {badges.map((b, i) => (
                  <span key={i} className="px-3 py-1 bg-orange-900/30 text-orange-400 rounded-full text-sm border border-orange-800">
                    {b.label}
                  </span>
                ))}
              </div>
              <div className="mt-4 flex items-center gap-4">
                <span className="text-yellow-400 text-lg">{avgRating} ★</span>
                <span className="text-gray-500">{reviews.length} review{reviews.length !== 1 ? 's' : ''}</span>
                {profile.jobs_completed > 0 && (
                  <span className="text-gray-500">{profile.jobs_completed} jobs completed</span>
                )}
              </div>
            </div>
          </div>
          {profile.bio && <p className="mt-6 text-gray-300">{profile.bio}</p>}
          {profile.skills?.length > 0 && (
            <div className="mt-4 flex gap-2 flex-wrap">
              {profile.skills.map((s, i) => (
                <span key={i} className="px-3 py-1 bg-gray-800 rounded-full text-sm text-gray-300">{s}</span>
              ))}
            </div>
          )}
        </div>

        {/* Reviews */}
        <div className="mt-8">
          <h2 className="text-xl font-semibold mb-4">Reviews</h2>
          {reviews.length === 0 ? (
            <p className="text-gray-500">No reviews yet.</p>
          ) : (
            <div className="space-y-4">
              {reviews.map((r) => (
                <div key={r.id} className="bg-gray-900 rounded-lg p-5 border border-gray-800">
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-yellow-400">{r.rating} ★</span>
                      <span className="text-gray-500 ml-2 text-sm">{new Date(r.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {r.comment && <p className="mt-2 text-gray-300">{r.comment}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}
