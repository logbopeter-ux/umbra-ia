package app.umbra.ia;

import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Message;
import android.webkit.ConsoleMessage;
import android.webkit.GeolocationPermissions;
import android.webkit.JsPromptResult;
import android.webkit.JsResult;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Umbra IA — activité principale.
 *
 * Le trombone de l'interface ouvre le sélecteur de fichiers d'Android. Sans
 * `onShowFileChooser`, la page web ne peut rien choisir : c'est le seul point
 * que Capacitor ne fournit pas.
 *
 * Tout le reste du client Chrome est délégué à celui de Capacitor — le micro,
 * la géolocalisation et les boîtes de dialogue en dépendent.
 */
public class MainActivity extends BridgeActivity {

    private static final int CODE_FICHIERS = 5173;

    private ValueCallback<Uri[]> cheminFichiers;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView vue = getBridge().getWebView();
        final WebChromeClient original = vue.getWebChromeClient();

        vue.setWebChromeClient(new WebChromeClient() {

            /* ── le seul comportement ajouté : choisir un fichier ── */
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (cheminFichiers != null) {
                    cheminFichiers.onReceiveValue(null);
                }
                cheminFichiers = callback;
                try {
                    Intent intention = params.createIntent();
                    intention.addCategory(Intent.CATEGORY_OPENABLE);
                    startActivityForResult(Intent.createChooser(intention, "Choisir un fichier"), CODE_FICHIERS);
                    return true;
                } catch (Exception e) {
                    cheminFichiers = null;
                    return false;
                }
            }

            /* ── tout le reste : Capacitor garde la main ── */
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                if (original != null) {
                    original.onPermissionRequest(request);
                } else {
                    super.onPermissionRequest(request);
                }
            }

            @Override
            public void onPermissionRequestCanceled(PermissionRequest request) {
                if (original != null) {
                    original.onPermissionRequestCanceled(request);
                } else {
                    super.onPermissionRequestCanceled(request);
                }
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                return original != null ? original.onConsoleMessage(message) : super.onConsoleMessage(message);
            }

            @Override
            public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
                if (original != null) {
                    original.onGeolocationPermissionsShowPrompt(origin, callback);
                } else {
                    super.onGeolocationPermissionsShowPrompt(origin, callback);
                }
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                return original != null ? original.onJsAlert(view, url, message, result) : super.onJsAlert(view, url, message, result);
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                return original != null ? original.onJsConfirm(view, url, message, result) : super.onJsConfirm(view, url, message, result);
            }

            @Override
            public boolean onJsPrompt(WebView view, String url, String message, String defaultValue, JsPromptResult result) {
                return original != null
                        ? original.onJsPrompt(view, url, message, defaultValue, result)
                        : super.onJsPrompt(view, url, message, defaultValue, result);
            }

            @Override
            public void onProgressChanged(WebView view, int newProgress) {
                if (original != null) {
                    original.onProgressChanged(view, newProgress);
                } else {
                    super.onProgressChanged(view, newProgress);
                }
            }

            @Override
            public void onReceivedTitle(WebView view, String title) {
                if (original != null) {
                    original.onReceivedTitle(view, title);
                } else {
                    super.onReceivedTitle(view, title);
                }
            }

            @Override
            public boolean onCreateWindow(WebView view, boolean isDialog, boolean isUserGesture, Message resultMsg) {
                return original != null
                        ? original.onCreateWindow(view, isDialog, isUserGesture, resultMsg)
                        : super.onCreateWindow(view, isDialog, isUserGesture, resultMsg);
            }
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == CODE_FICHIERS) {
            if (cheminFichiers != null) {
                Uri[] resultats = null;
                if (resultCode == RESULT_OK && data != null) {
                    if (data.getClipData() != null) {
                        int n = data.getClipData().getItemCount();
                        resultats = new Uri[n];
                        for (int i = 0; i < n; i++) {
                            resultats[i] = data.getClipData().getItemAt(i).getUri();
                        }
                    } else if (data.getData() != null) {
                        resultats = new Uri[]{ data.getData() };
                    }
                }
                cheminFichiers.onReceiveValue(resultats);
                cheminFichiers = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }
}
