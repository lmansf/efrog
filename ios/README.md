# eFrog iOS

SwiftUI native app. Uses ONNX Runtime Mobile for on-device frog call classification, Auth0.swift for authentication, and supabase-swift for data sync.

## Auth0 Setup

### Auth0 Dashboard

In your Auth0 Dashboard → Applications → (the existing eFrog SPA application) → Settings, add the following to the existing entries:

**Allowed Callback URLs** — append:
```
com.efrog.ios://dev-rbxcy3tqjhebw7aa.us.auth0.com/ios/com.efrog.ios/callback
```

**Allowed Logout URLs** — append:
```
com.efrog.ios://dev-rbxcy3tqjhebw7aa.us.auth0.com/ios/com.efrog.ios/callback
```

### Xcode — URL Scheme

1. Open the `eFrog` target in Xcode.
2. Go to **Info → URL Types → +**.
3. Set **Identifier** to `com.efrog.ios` and **URL Schemes** to `com.efrog.ios`.

This allows Auth0's `ASWebAuthenticationSession` to redirect back to the app after login/logout.

### Auth0.plist

`ios/eFrog/Auth/Auth0.plist` is already configured with the correct domain and client ID. Add it to the Xcode target so it is included in the app bundle — Auth0.swift reads it automatically.
