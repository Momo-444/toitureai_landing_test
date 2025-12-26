import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { checkRateLimit, getClientIdentifier } from "../utils/rateLimiter";
import { Turnstile } from "./Turnstile";

// Configuration via variables d'environnement (plus de credentials hardcodées)
const WEBHOOK_CONFIG = {
    url: import.meta.env.PUBLIC_N8N_WEBHOOK_URL,
    secret: import.meta.env.PUBLIC_N8N_WEBHOOK_SECRET,
};

const formSchema = z.object({
    prenom: z.string().min(2, "Le prénom doit contenir au moins 2 caractères"),
    nom: z.string().min(2, "Le nom doit contenir au moins 2 caractères"),
    email: z.string().email("Email invalide"),
    telephone: z.string().min(10, "Numéro de téléphone invalide"),
    typeDeProjet: z.string().min(1, "Veuillez sélectionner un type de projet"),
    surface: z.string().optional(),
    budget: z.string().optional(),
    adresse: z.string().min(5, "L'adresse est requise"),
    ville: z.string().min(2, "La ville est requise"),
    codePostal: z.string().min(5, "Le code postal est requis"),
    delai: z.string().optional(),
    description: z.string().optional(),
    rgpd: z.boolean().refine((val) => val === true, {
        message: "Vous devez accepter la politique de confidentialité",
    }),
});

type FormValues = z.infer<typeof formSchema>;

export default function ContactForm() {
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);
    const [submitError, setSubmitError] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [googleMapsError, setGoogleMapsError] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const addressInputRef = useRef<HTMLInputElement>(null);

    const {
        register,
        handleSubmit,
        formState: { errors },
        setValue,
        trigger,
        reset,
    } = useForm<FormValues>({
        resolver: zodResolver(formSchema),
        defaultValues: {
            prenom: "",
            nom: "",
            email: "",
            telephone: "",
            typeDeProjet: "",
            surface: "",
            budget: "",
            adresse: "",
            ville: "",
            codePostal: "",
            delai: "",
            description: "",
            rgpd: false,
        },
    });

    // Load Google Maps avec variable d'environnement
    useEffect(() => {
        const apiKey = import.meta.env.PUBLIC_GOOGLE_MAPS_API_KEY;
        if (!apiKey) {
            console.warn("Google Maps API key not configured");
            setGoogleMapsError(true);
            return;
        }

        // Vérifier si le script est déjà chargé
        if ((window as any).google?.maps?.places) {
            return;
        }

        // Vérifier si un script Google Maps est déjà en cours de chargement
        const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
        if (existingScript) {
            return;
        }

        const script = document.createElement("script");
        // Ajout de loading=async pour éviter le warning de performance
        script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&language=fr&region=FR&loading=async&callback=initMap`;
        script.async = true;

        (window as any).initMap = () => {
            // Script chargé
        };

        script.onerror = () => {
            setGoogleMapsError(true);
        };

        document.head.appendChild(script);

        const timeout = setTimeout(() => {
            if (typeof (window as any).google === "undefined") {
                setGoogleMapsError(true);
            }
        }, 5000);

        return () => {
            clearTimeout(timeout);
        };
    }, []);

    // Initialize autocomplete
    useEffect(() => {
        if (googleMapsError) return;

        const initAutocomplete = () => {
            if (typeof (window as any).google === "undefined" || !addressInputRef.current) {
                return;
            }

            try {
                const google = (window as any).google;
                const autocompleteInstance = new google.maps.places.Autocomplete(addressInputRef.current, {
                    types: ["address"],
                    componentRestrictions: { country: "fr" },
                    fields: ["address_components", "formatted_address", "geometry"],
                });

                autocompleteInstance.addListener("place_changed", () => {
                    const place = autocompleteInstance.getPlace();

                    if (!place.address_components) return;

                    let rue = "";
                    let numero = "";
                    let ville = "";
                    let codePostal = "";

                    place.address_components.forEach((component: any) => {
                        const types = component.types;
                        if (types.includes("street_number")) numero = component.long_name;
                        if (types.includes("route")) rue = component.long_name;
                        if (types.includes("locality")) ville = component.long_name;
                        if (types.includes("postal_code")) codePostal = component.long_name;
                    });

                    const adresseComplete = `${numero} ${rue}`.trim();
                    setValue("adresse", adresseComplete);
                    setValue("ville", ville);
                    setValue("codePostal", codePostal);
                    trigger(["adresse", "ville", "codePostal"]);
                });
            } catch (error) {
                setGoogleMapsError(true);
            }
        };

        const timer = setTimeout(initAutocomplete, 1000);
        return () => clearTimeout(timer);
    }, [googleMapsError, setValue, trigger]);

    const onSubmit = async (data: FormValues) => {
        // Rate limiting check
        const clientId = getClientIdentifier();
        const { allowed, retryAfter } = checkRateLimit(clientId);

        if (!allowed) {
            setErrorMessage(`Trop de requêtes. Réessayez dans ${retryAfter} secondes.`);
            setSubmitError(true);
            return;
        }

        // Vérification Turnstile (si configuré)
        const turnstileSiteKey = import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
        if (turnstileSiteKey && !turnstileToken) {
            setErrorMessage("Veuillez compléter la vérification de sécurité.");
            setSubmitError(true);
            return;
        }

        // Vérification de la configuration webhook
        if (!WEBHOOK_CONFIG.url || !WEBHOOK_CONFIG.secret) {
            setErrorMessage("Configuration du formulaire incorrecte. Contactez-nous par téléphone.");
            setSubmitError(true);
            return;
        }

        setIsSubmitting(true);
        setSubmitError(false);
        setSubmitSuccess(false);
        setErrorMessage(null);

        try {
            const payload = {
                ...data,
                surface: data.surface ? parseInt(data.surface) : null,
                budget: data.budget ? parseInt(data.budget) : null,
                timestamp: new Date().toISOString(),
                source: "landing-page-astro",
                ...(turnstileToken && { turnstileToken }),
            };

            const response = await fetch(WEBHOOK_CONFIG.url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "X-Webhook-Secret": WEBHOOK_CONFIG.secret,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                throw new Error(`Webhook error: ${response.status}`);
            }

            setSubmitSuccess(true);
            reset();
            setTurnstileToken(null);
        } catch (error) {
            console.error("Form submission error:", error);
            setErrorMessage("Une erreur s'est produite. Veuillez réessayer ou nous appeler directement.");
            setSubmitError(true);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleTurnstileVerify = (token: string) => {
        setTurnstileToken(token);
    };

    const handleTurnstileError = () => {
        setErrorMessage("Erreur de vérification. Rechargez la page.");
        setSubmitError(true);
    };

    return (
        <section id="formulaire" className="section-container bg-gradient-to-br from-primary-900 via-primary-800 to-accent-900 relative overflow-hidden">
            {/* Background decoration */}
            <div className="absolute inset-0 opacity-10">
                <div className="absolute top-0 left-0 w-96 h-96 bg-accent-500 rounded-full blur-3xl"></div>
                <div className="absolute bottom-0 right-0 w-96 h-96 bg-secondary-500 rounded-full blur-3xl"></div>
            </div>

            <div className="relative z-10 max-w-3xl mx-auto">
                <div className="glass-card-dark p-8 md:p-12">
                    <div className="text-center mb-8">
                        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-accent-500/20 backdrop-blur-md border border-accent-400/30 mb-4">
                            <span className="text-2xl">⚡</span>
                            <span className="text-white font-semibold">Réponse sous 24h garantie</span>
                        </div>
                        <h2 className="text-3xl md:text-4xl font-display font-bold text-white mb-4">
                            Obtenez Votre Devis Gratuit
                        </h2>
                        <p className="text-primary-100 text-lg">
                            Remplissez ce formulaire en 30 secondes • 100% gratuit • Sans engagement
                        </p>
                    </div>

                    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-white font-medium mb-2">Prénom *</label>
                                <input
                                    {...register("prenom")}
                                    type="text"
                                    placeholder="Jean"
                                    className="input-glass"
                                />
                                {errors.prenom && (
                                    <p className="text-accent-300 text-sm mt-1">{errors.prenom.message}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-white font-medium mb-2">Nom *</label>
                                <input
                                    {...register("nom")}
                                    type="text"
                                    placeholder="Dupont"
                                    className="input-glass"
                                />
                                {errors.nom && (
                                    <p className="text-accent-300 text-sm mt-1">{errors.nom.message}</p>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Email *</label>
                            <input
                                {...register("email")}
                                type="email"
                                placeholder="jean.dupont@exemple.fr"
                                className="input-glass"
                            />
                            {errors.email && (
                                <p className="text-accent-300 text-sm mt-1">{errors.email.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Téléphone *</label>
                            <input
                                {...register("telephone")}
                                type="tel"
                                placeholder="06 12 34 56 78"
                                className="input-glass"
                            />
                            {errors.telephone && (
                                <p className="text-accent-300 text-sm mt-1">{errors.telephone.message}</p>
                            )}
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Type de projet *</label>
                            <select {...register("typeDeProjet")} className="input-glass">
                                <option value="">Sélectionnez un type de projet</option>
                                <option value="reparation">Réparation (fuite, tuiles cassées...)</option>
                                <option value="renovation">Rénovation complète</option>
                                <option value="isolation">Isolation thermique</option>
                                <option value="installation">Installation neuve</option>
                                <option value="maintenance">Entretien / Maintenance</option>
                                <option value="autre">Autre</option>
                            </select>
                            {errors.typeDeProjet && (
                                <p className="text-accent-300 text-sm mt-1">{errors.typeDeProjet.message}</p>
                            )}
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-white font-medium mb-2">Surface (m²)</label>
                                <input
                                    {...register("surface")}
                                    type="number"
                                    placeholder="100"
                                    className="input-glass"
                                />
                            </div>

                            <div>
                                <label className="block text-white font-medium mb-2">Budget estimé (€)</label>
                                <input
                                    {...register("budget")}
                                    type="number"
                                    placeholder="5000"
                                    step="100"
                                    className="input-glass"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Adresse du projet *</label>
                            <input
                                {...register("adresse")}
                                ref={addressInputRef}
                                type="text"
                                placeholder={googleMapsError ? "Ex: 12 Rue de la République" : "Commencez à taper votre adresse..."}
                                className="input-glass"
                                autoComplete="off"
                            />
                            {errors.adresse && (
                                <p className="text-accent-300 text-sm mt-1">{errors.adresse.message}</p>
                            )}
                            {!googleMapsError && (
                                <p className="text-primary-200 text-sm mt-1">
                                    Commencez à taper, les suggestions apparaîtront automatiquement
                                </p>
                            )}
                        </div>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-white font-medium mb-2">Ville *</label>
                                <input
                                    {...register("ville")}
                                    type="text"
                                    placeholder="Metz"
                                    readOnly={!googleMapsError}
                                    className={`input-glass ${!googleMapsError ? 'bg-white/40' : ''}`}
                                />
                                {errors.ville && (
                                    <p className="text-accent-300 text-sm mt-1">{errors.ville.message}</p>
                                )}
                            </div>

                            <div>
                                <label className="block text-white font-medium mb-2">Code postal *</label>
                                <input
                                    {...register("codePostal")}
                                    type="text"
                                    placeholder="57000"
                                    readOnly={!googleMapsError}
                                    className={`input-glass ${!googleMapsError ? 'bg-white/40' : ''}`}
                                />
                                {errors.codePostal && (
                                    <p className="text-accent-300 text-sm mt-1">{errors.codePostal.message}</p>
                                )}
                            </div>
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Délai souhaité</label>
                            <select {...register("delai")} className="input-glass">
                                <option value="">Choisissez un délai</option>
                                <option value="urgent">Urgent (sous 48h)</option>
                                <option value="1-2-semaines">Dans 1-2 semaines</option>
                                <option value="1-mois">Dans 1 mois</option>
                                <option value="3-mois">Dans 2-3 mois</option>
                                <option value="flexible">Flexible / À convenir</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-white font-medium mb-2">Description du projet (optionnel)</label>
                            <textarea
                                {...register("description")}
                                placeholder="Décrivez votre besoin : problème constaté, urgence, attentes particulières..."
                                rows={4}
                                className="input-glass resize-none"
                            />
                        </div>

                        <div className="flex items-start gap-3">
                            <input
                                {...register("rgpd")}
                                type="checkbox"
                                id="rgpd"
                                className="mt-1 w-5 h-5 rounded border-primary-300 text-accent-500 focus:ring-accent-500"
                            />
                            <label htmlFor="rgpd" className="text-sm text-primary-100 leading-relaxed cursor-pointer">
                                J'accepte que mes données soient utilisées pour traiter ma demande de devis conformément à la
                                <a href="/mentions-legales" className="text-accent-300 hover:text-accent-200 underline ml-1">
                                    politique de confidentialité
                                </a>
                                . *
                            </label>
                        </div>
                        {errors.rgpd && (
                            <p className="text-accent-300 text-sm">{errors.rgpd.message}</p>
                        )}

                        {/* Cloudflare Turnstile CAPTCHA */}
                        <div className="flex justify-center">
                            <Turnstile
                                onVerify={handleTurnstileVerify}
                                onError={handleTurnstileError}
                            />
                        </div>

                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="btn-gradient w-full text-xl py-5 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isSubmitting ? (
                                <span className="flex items-center justify-center gap-2">
                                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    <span>Envoi en cours...</span>
                                </span>
                            ) : (
                                "Envoyer Ma Demande"
                            )}
                        </button>

                        <p className="text-center text-sm text-primary-200">Les champs marqués d'un * sont obligatoires</p>
                    </form>

                    {submitSuccess && (
                        <div className="mt-6 glass-card bg-secondary-500/20 border-secondary-400/30 p-6 rounded-2xl">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-secondary-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h3 className="text-white font-bold text-lg mb-1">Demande envoyée avec succès !</h3>
                                    <p className="text-primary-100">
                                        Nous avons bien reçu votre demande de devis. Notre équipe vous contactera sous 24h maximum.
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}

                    {submitError && (
                        <div className="mt-6 glass-card bg-accent-500/20 border-accent-400/30 p-6 rounded-2xl">
                            <div className="flex items-start gap-3">
                                <svg className="w-6 h-6 text-accent-300 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <div>
                                    <h3 className="text-white font-bold text-lg mb-1">Erreur lors de l'envoi</h3>
                                    <p className="text-primary-100">
                                        {errorMessage || "Une erreur s'est produite. Veuillez réessayer ou nous appeler directement au 06 44 99 32 31."}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center mt-8 text-white">
                    <p className="text-lg mb-4 flex items-center justify-center gap-2">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                        <span>Vos données sont sécurisées et ne seront jamais partagées</span>
                    </p>
                    <div className="flex justify-center gap-8 flex-wrap text-primary-100">
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Réponse sous 24h</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>Sans engagement</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <svg className="w-5 h-5 text-secondary-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                            </svg>
                            <span>100% gratuit</span>
                        </div>
                    </div>
                </div>
            </div>
        </section>
    );
}
