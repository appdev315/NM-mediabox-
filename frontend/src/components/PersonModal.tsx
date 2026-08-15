import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../context/LanguageContext';

interface PersonModalProps {
  personId: number | string;
  onClose: () => void;
  fetchPersonDetails: (id: number | string) => Promise<any>;
}

export const PersonModal: React.FC<PersonModalProps> = ({ personId, onClose, fetchPersonDetails }) => {
  const [person, setPerson] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { t } = useLanguage();

  useEffect(() => {
    let isMounted = true;
    fetchPersonDetails(personId)
      .then((data) => {
        if (isMounted) {
          setPerson(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch person details:', err);
        if (isMounted) setLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [personId, fetchPersonDetails]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-3xl bg-[var(--bg-color)] text-[var(--text-color)] rounded-2xl overflow-hidden shadow-2xl border border-white/10 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center px-5 py-4 border-b border-white/10 bg-black/20 sticky top-0 backdrop-blur-md z-10">
          <h2 className="text-xl font-bold truncate pr-4">
            {loading ? t('loading') : person?.name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-white/10 text-gray-400 hover:text-white transition-colors flex-shrink-0"
          >
            ✕
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-6 flex-1">
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
            </div>
          ) : person ? (
            <>
              {/* Photo & Info Row */}
              <div className="flex flex-col sm:flex-row gap-6 items-start">
                <img
                  src={person.profile_path}
                  alt={person.name}
                  className="w-36 sm:w-44 aspect-[2/3] object-cover rounded-xl shadow-lg border border-white/10 flex-shrink-0 mx-auto sm:mx-0"
                />
                <div className="space-y-3 flex-1">
                  <h1 className="text-2xl font-extrabold">{person.name}</h1>
                  
                  {person.birthday && (
                    <p className="text-sm opacity-80">
                      🎂 <span className="font-semibold">{t('dateOfBirth')}:</span> {person.birthday}
                    </p>
                  )}
                  {person.place_of_birth && (
                    <p className="text-sm opacity-80">
                      📍 <span className="font-semibold">{t('placeOfBirth')}:</span> {person.place_of_birth}
                    </p>
                  )}
                </div>
              </div>

              {/* Biography Section */}
              {person.biography && (
                <div className="space-y-2 border-t border-white/10 pt-4">
                  <h3 className="text-lg font-bold">{t('biography')}</h3>
                  <p className="text-sm leading-relaxed opacity-90 whitespace-pre-line max-h-48 overflow-y-auto pr-2">
                    {person.biography}
                  </p>
                </div>
              )}

              {/* Known For / Filmography Carousel */}
              {person.knownFor && person.knownFor.length > 0 && (
                <div className="space-y-3 border-t border-white/10 pt-4">
                  <h3 className="text-lg font-bold">{t('knownFor')}</h3>
                  <div className="flex gap-3 overflow-x-auto pb-3 pt-1 scrollbar-thin">
                    {person.knownFor.map((item: any) => (
                      <div
                        key={item.id}
                        onClick={() => {
                          onClose();
                          navigate(`/${item.type === 'series' ? 'movie' : 'movie'}/${item.id}?type=${item.type}`);
                        }}
                        className="w-28 flex-shrink-0 cursor-pointer group space-y-1.5"
                      >
                        <img
                          src={item.poster}
                          alt={item.title}
                          className="w-28 aspect-[2/3] object-cover rounded-lg shadow group-hover:scale-105 transition-transform duration-200"
                        />
                        <p className="text-xs font-bold truncate group-hover:text-blue-400 transition-colors">
                          {item.title}
                        </p>
                        {item.year && (
                          <p className="text-[10px] opacity-60">
                            {item.year}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="text-center text-sm opacity-60 py-8">{t('infoMissing')}</p>
          )}
        </div>
      </div>
    </div>
  );
};
