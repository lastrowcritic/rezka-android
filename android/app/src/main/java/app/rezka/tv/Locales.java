package app.rezka.tv;

import android.content.Context;
import android.content.res.Configuration;
import java.util.Locale;

/** Applies the interface language chosen in the app to the native screens: the player, website verification and download notifications. */
final class Locales {
    private static final String PREFERENCES="rezka-language",KEY="language";
    private Locales(){}
    /** Saves the language the web interface resolved. Anything else falls back to the device language. */
    static void save(Context context,String language){
        var preferences=context.getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE).edit();
        if(supported(language))preferences.putString(KEY,language);else preferences.remove(KEY);
        preferences.apply();
    }
    static Context wrap(Context base){
        String language=base.getSharedPreferences(PREFERENCES,Context.MODE_PRIVATE).getString(KEY,"");
        if(!supported(language))return base;
        Configuration configuration=new Configuration(base.getResources().getConfiguration());configuration.setLocale(Locale.forLanguageTag(language));
        return base.createConfigurationContext(configuration);
    }
    static Locale current(Context context){return context.getResources().getConfiguration().getLocales().get(0);}
    private static boolean supported(String language){return "en".equals(language)||"ru".equals(language)||"uk".equals(language);}
}
