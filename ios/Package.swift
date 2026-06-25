// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "eFrog",
    platforms: [.iOS(.v16)],
    targets: [
        .target(
            name: "eFrog",
            dependencies: [
                .product(name: "OrtSwift", package: "onnxruntime"),
                .product(name: "Auth0", package: "Auth0.swift"),
                .product(name: "Supabase", package: "supabase-swift"),
            ],
            path: "eFrog",
            resources: [
                .copy("Resources/frog_classifier.onnx"),
                .copy("Resources/labels.json"),
                .process("Assets.xcassets"),
            ]
        ),
    ],
    dependencies: [
        .package(url: "https://github.com/microsoft/onnxruntime", from: "1.20.0"),
        .package(url: "https://github.com/auth0/Auth0.swift", .upToNextMajor(from: "2.0.0")),
        .package(url: "https://github.com/supabase/supabase-swift", .upToNextMajor(from: "2.0.0")),
    ]
)
