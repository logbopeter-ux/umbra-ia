package app.umbra.ia;

import com.getcapacitor.BridgeActivity;

/**
 * Umbra IA — activité principale.
 *
 * Aucune personnalisation : Capacitor fournit déjà le sélecteur de fichiers
 * (BridgeWebChromeClient.onShowFileChooser), y compris l'appareil photo et la
 * galerie. Une version précédente remplaçait ce client pour implémenter le
 * choix de fichier « à la main » — le trombone ne s'ouvrait alors plus.
 * On laisse donc le comportement d'origine, qui est complet.
 */
public class MainActivity extends BridgeActivity {}
