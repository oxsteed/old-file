import Expo
import React
import ReactAppDependencyProvider

@UIApplicationMain
public class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory
    bindReactNativeFactory(factory)

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    if let metroURL = RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry") {
      // Metro is reachable (developer ran `expo start`), prefer the live JS bundle.
      return metroURL
    }
    // No packager running. Fall through to bundled JS so native launches without dev server still work.
    return resolveBundledJavaScriptURL()
#else
    return resolveBundledJavaScriptURL()
#endif
  }

  private func resolveBundledJavaScriptURL() -> URL? {
    // 1) Canonical location: main.jsbundle inside the .app resource root.
    if let directURL = Bundle.main.url(forResource: "main", withExtension: "jsbundle") {
      NSLog("OxSteedOne: resolved bundled JS at %@", directURL.path)
      return directURL
    }

    // 2) Sibling of the .app (some packaging layouts leave it next to the app).
    let siblingURL = Bundle.main.bundleURL
      .deletingLastPathComponent()
      .appendingPathComponent("main.jsbundle")
    if FileManager.default.fileExists(atPath: siblingURL.path) {
      NSLog("OxSteedOne: resolved sibling JS bundle at %@", siblingURL.path)
      return siblingURL
    }

    // 3) Recursive search inside the .app for any *.jsbundle (defensive last resort).
    if let enumerator = FileManager.default.enumerator(
      at: Bundle.main.bundleURL,
      includingPropertiesForKeys: [.isRegularFileKey],
      options: [.skipsHiddenFiles]
    ) {
      for case let candidateURL as URL in enumerator {
        guard candidateURL.pathExtension == "jsbundle" else {
          continue
        }
        NSLog("OxSteedOne: resolved fallback JS bundle at %@", candidateURL.path)
        return candidateURL
      }
    }

    NSLog("OxSteedOne: failed to locate bundled JS. bundleURL=%@", Bundle.main.bundleURL.path)
    return nil
  }
}
