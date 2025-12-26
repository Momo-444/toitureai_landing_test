import { useEffect, useRef, useCallback } from 'react';

interface TurnstileProps {
  onVerify: (token: string) => void;
  onError?: () => void;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

// Variable globale pour éviter les chargements multiples
let turnstileScriptLoaded = false;
let turnstileScriptLoading = false;

export function Turnstile({ onVerify, onError }: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);

  // Récupérer la sitekey de manière sûre
  const siteKey = typeof import.meta.env.PUBLIC_TURNSTILE_SITE_KEY === 'string'
    ? import.meta.env.PUBLIC_TURNSTILE_SITE_KEY
    : '';

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile || !siteKey || widgetIdRef.current) {
      return;
    }

    try {
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token: string) => {
          if (mountedRef.current) {
            onVerify(token);
          }
        },
        'error-callback': () => {
          if (mountedRef.current && onError) {
            onError();
          }
        },
        theme: 'light',
      });
    } catch (error) {
      console.error('Turnstile render error:', error);
    }
  }, [siteKey, onVerify, onError]);

  useEffect(() => {
    mountedRef.current = true;

    // Si pas de sitekey, ne rien faire
    if (!siteKey) {
      console.log('Turnstile: No site key configured, skipping');
      return;
    }

    // Si le script est déjà chargé, render directement
    if (turnstileScriptLoaded && window.turnstile) {
      renderWidget();
      return;
    }

    // Si le script est en cours de chargement, attendre
    if (turnstileScriptLoading) {
      const checkInterval = setInterval(() => {
        if (turnstileScriptLoaded && window.turnstile) {
          clearInterval(checkInterval);
          renderWidget();
        }
      }, 100);

      return () => {
        clearInterval(checkInterval);
      };
    }

    // Charger le script pour la première fois
    turnstileScriptLoading = true;

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad';
    script.async = true;
    script.defer = true;

    window.onTurnstileLoad = () => {
      turnstileScriptLoaded = true;
      turnstileScriptLoading = false;
      if (mountedRef.current) {
        renderWidget();
      }
    };

    script.onerror = () => {
      turnstileScriptLoading = false;
      console.error('Failed to load Turnstile script');
      if (mountedRef.current && onError) {
        onError();
      }
    };

    document.head.appendChild(script);

    return () => {
      mountedRef.current = false;
      // Cleanup widget si nécessaire
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch (e) {
          // Ignorer les erreurs de cleanup
        }
        widgetIdRef.current = null;
      }
    };
  }, [siteKey, renderWidget, onError]);

  // Ne rien afficher si pas de sitekey
  if (!siteKey) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="cf-turnstile flex justify-center my-4"
      data-sitekey={siteKey}
    />
  );
}
