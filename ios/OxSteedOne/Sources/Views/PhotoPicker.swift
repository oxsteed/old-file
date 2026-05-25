import SwiftUI
import PhotosUI

/// A SwiftUI-compatible wrapper around PHPickerViewController.
///
/// Usage:
/// ```swift
/// @State private var showPicker = false
/// @State private var selectedImages: [UIImage] = []
///
/// .sheet(isPresented: $showPicker) {
///     PhotoPicker(selectedImages: $selectedImages, maxSelection: 5)
/// }
/// ```
struct PhotoPicker: UIViewControllerRepresentable {
    @Binding var selectedImages: [UIImage]
    var maxSelection: Int = 5
    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIViewController(context: Context) -> PHPickerViewController {
        var config = PHPickerConfiguration(photoLibrary: .shared())
        config.selectionLimit = maxSelection
        config.filter = .images
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: PHPickerViewController, context: Context) {}

    // MARK: - Coordinator

    final class Coordinator: NSObject, PHPickerViewControllerDelegate {
        private let parent: PhotoPicker

        init(_ parent: PhotoPicker) {
            self.parent = parent
        }

        func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
            parent.dismiss()
            guard !results.isEmpty else { return }

            var loaded: [UIImage] = []
            let group = DispatchGroup()

            for result in results {
                guard result.itemProvider.canLoadObject(ofClass: UIImage.self) else { continue }
                group.enter()
                result.itemProvider.loadObject(ofClass: UIImage.self) { object, _ in
                    defer { group.leave() }
                    if let image = object as? UIImage {
                        loaded.append(image)
                    }
                }
            }

            group.notify(queue: .main) { [weak self] in
                guard let self else { return }
                // Append (don't replace) so multiple picker sessions accumulate
                self.parent.selectedImages.append(contentsOf: loaded)
            }
        }
    }
}

/// A compact horizontal thumbnail strip showing selected photos with a remove button per photo.
struct PhotoThumbnailStrip: View {
    @Binding var images: [UIImage]
    var onAdd: () -> Void

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // Add-photo tile
                Button(action: onAdd) {
                    VStack(spacing: 4) {
                        Image(systemName: "photo.badge.plus")
                            .font(.system(size: 22))
                        Text("Add")
                            .font(.caption2)
                    }
                    .frame(width: 72, height: 72)
                    .background(Color.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .foregroundStyle(OneTheme.amber)
                }

                // Thumbnails
                ForEach(images.indices, id: \.self) { idx in
                    ZStack(alignment: .topTrailing) {
                        Image(uiImage: images[idx])
                            .resizable()
                            .scaledToFill()
                            .frame(width: 72, height: 72)
                            .clipped()
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))

                        Button {
                            images.remove(at: idx)
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .red)
                                .font(.system(size: 18))
                        }
                        .padding(3)
                    }
                }
            }
            .padding(.vertical, 4)
        }
    }
}
