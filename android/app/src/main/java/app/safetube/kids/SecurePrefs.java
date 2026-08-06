package app.safetube.kids;

import android.content.Context;
import android.content.SharedPreferences;
import androidx.security.crypto.EncryptedSharedPreferences;
import androidx.security.crypto.MasterKey;

/**
 * AES-256 EncryptedSharedPreferences backed by the Android Keystore.
 * Used for child access tokens and other secrets that must not sit in plaintext prefs.
 */
public final class SecurePrefs {
    private static final String FILE = "safetube_secure_prefs";
    private static SharedPreferences instance;

    private SecurePrefs() {}

    public static synchronized SharedPreferences get(Context ctx) {
        if (instance != null) return instance;
        try {
            MasterKey masterKey = new MasterKey.Builder(ctx.getApplicationContext())
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build();
            instance = EncryptedSharedPreferences.create(
                ctx.getApplicationContext(),
                FILE,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            );
        } catch (Exception e) {
            // Last-resort fallback — never crash the app if Keystore is unavailable.
            instance = ctx.getApplicationContext()
                .getSharedPreferences(FILE + "_fallback", Context.MODE_PRIVATE);
        }
        return instance;
    }

    public static void put(Context ctx, String key, String value) {
        SharedPreferences.Editor ed = get(ctx).edit();
        if (value == null) ed.remove(key);
        else ed.putString(key, value);
        ed.apply();
    }

    public static String getString(Context ctx, String key) {
        return get(ctx).getString(key, null);
    }

    public static void remove(Context ctx, String key) {
        get(ctx).edit().remove(key).apply();
    }
}
