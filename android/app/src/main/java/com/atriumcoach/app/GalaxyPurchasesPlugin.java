package com.atriumcoach.app;

import android.provider.Settings;

import androidx.annotation.NonNull;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.revenuecat.purchases.CustomerInfo;
import com.revenuecat.purchases.Offering;
import com.revenuecat.purchases.Offerings;
import com.revenuecat.purchases.Package;
import com.revenuecat.purchases.PurchaseParams;
import com.revenuecat.purchases.Purchases;
import com.revenuecat.purchases.PurchasesConfiguration;
import com.revenuecat.purchases.PurchasesError;
import com.revenuecat.purchases.galaxy.GalaxyBillingMode;
import com.revenuecat.purchases.galaxy.GalaxyConfiguration;
import com.revenuecat.purchases.interfaces.LogInCallback;
import com.revenuecat.purchases.interfaces.PurchaseCallback;
import com.revenuecat.purchases.interfaces.ReceiveCustomerInfoCallback;
import com.revenuecat.purchases.interfaces.ReceiveOfferingsCallback;
import com.revenuecat.purchases.models.StoreTransaction;

/**
 * Samsung Galaxy Store purchases through RevenueCat, for the web app (src/platform/billing/purchases.ts).
 *
 * RevenueCat's Capacitor plugin has no Galaxy Store support yet, so this wraps its Android SDK
 * configured with GalaxyConfiguration. The web app logs in with the Firebase uid, so purchases and
 * the webhook belong to that account; the server, not this plugin, decides the plan.
 *
 * A RevenueCat Test Store key ("test_…") configures the plain SDK instead: purchases then go through
 * RevenueCat's test dialog, with no store, for trying the whole flow before the Galaxy Store is ready.
 */
@CapacitorPlugin(name = "GalaxyPurchases")
public class GalaxyPurchasesPlugin extends Plugin {

    /** The current offering's packages, kept so `purchase` can find the one the user picked. */
    private Offering current;

    @PluginMethod
    public void configure(PluginCall call) {
        String apiKey = call.getString("apiKey", "");
        String appUserId = call.getString("appUserId", "");
        if (apiKey.isEmpty() || appUserId.isEmpty()) {
            call.reject("apiKey and appUserId are required");
            return;
        }
        if (Purchases.isConfigured()) {
            // Another account signed in on this device: switch RevenueCat to it.
            Purchases.getSharedInstance().logIn(appUserId, new LogInCallback() {
                @Override
                public void onReceived(@NonNull CustomerInfo customerInfo, boolean created) {
                    call.resolve();
                }

                @Override
                public void onError(@NonNull PurchasesError error) {
                    call.reject(error.getMessage());
                }
            });
            return;
        }
        boolean testMode = Boolean.TRUE.equals(call.getBoolean("testMode", false));
        // Google Play ("goog_") and RevenueCat test keys use Play Billing; any other key is the Galaxy Store app's.
        PurchasesConfiguration.Builder builder = apiKey.startsWith("test_") || apiKey.startsWith("goog_")
                ? new PurchasesConfiguration.Builder(getContext().getApplicationContext(), apiKey)
                : new GalaxyConfiguration.Builder(
                        getContext().getApplicationContext(),
                        apiKey,
                        testMode ? GalaxyBillingMode.TEST : GalaxyBillingMode.PRODUCTION
                );
        builder.appUserID(appUserId);
        Purchases.configure(builder.build());
        call.resolve();
    }

    @PluginMethod
    public void getPackages(PluginCall call) {
        Purchases.getSharedInstance().getOfferings(new ReceiveOfferingsCallback() {
            @Override
            public void onReceived(@NonNull Offerings offerings) {
                current = offerings.getCurrent();
                JSArray list = new JSArray();
                if (current != null) {
                    for (Package pkg : current.getAvailablePackages()) {
                        JSObject item = new JSObject();
                        item.put("id", pkg.getIdentifier());
                        item.put("productId", pkg.getProduct().getId());
                        item.put("price", pkg.getProduct().getPrice().getFormatted());
                        list.put(item);
                    }
                }
                JSObject result = new JSObject();
                result.put("packages", list);
                call.resolve(result);
            }

            @Override
            public void onError(@NonNull PurchasesError error) {
                call.reject(error.getMessage());
            }
        });
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String packageId = call.getString("packageId", "");
        Package chosen = null;
        if (current != null) {
            for (Package pkg : current.getAvailablePackages()) {
                if (pkg.getIdentifier().equals(packageId)) chosen = pkg;
            }
        }
        if (chosen == null) {
            call.reject("unknown package");
            return;
        }
        PurchaseParams params = new PurchaseParams.Builder(getActivity(), chosen).build();
        Purchases.getSharedInstance().purchase(params, new PurchaseCallback() {
            @Override
            public void onCompleted(@NonNull StoreTransaction transaction, @NonNull CustomerInfo customerInfo) {
                call.resolve();
            }

            @Override
            public void onError(@NonNull PurchasesError error, boolean userCancelled) {
                call.reject(userCancelled ? "cancelled" : error.getMessage());
            }
        });
    }

    /**
     * Android's per-app device id (the same across reinstalls and accounts on this phone). The server
     * stores only a keyed hash of it, to give one free trial per phone (backend/app/platform/trial.py).
     */
    @PluginMethod
    public void deviceId(PluginCall call) {
        JSObject result = new JSObject();
        result.put("id", Settings.Secure.getString(getContext().getContentResolver(), Settings.Secure.ANDROID_ID));
        call.resolve(result);
    }

    @PluginMethod
    public void restore(PluginCall call) {
        Purchases.getSharedInstance().restorePurchases(new ReceiveCustomerInfoCallback() {
            @Override
            public void onReceived(@NonNull CustomerInfo customerInfo) {
                call.resolve();
            }

            @Override
            public void onError(@NonNull PurchasesError error) {
                call.reject(error.getMessage());
            }
        });
    }
}
