import SwiftUI
import PhotosUI

// MARK: - Reusable image picker + upload button

struct ImagePickerButton: View {
    let label: String
    let purpose: String
    @Binding var uploadedURLs: [String]
    @Binding var isUploading: Bool

    @State private var pickerItems: [PhotosPickerItem] = []

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            PhotosPicker(selection: $pickerItems, maxSelectionCount: 5,
                         matching: .images, photoLibrary: .shared()) {
                HStack(spacing: 8) {
                    if isUploading {
                        ProgressView().tint(Theme.accent)
                    } else {
                        Image(systemName: "photo.badge.plus")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Theme.accent)
                    }
                    Text(label)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Theme.accent)
                    if !uploadedURLs.isEmpty {
                        Text("(\(uploadedURLs.count) uploaded)")
                            .font(.system(size: 11)).foregroundStyle(Theme.textTertiary)
                    }
                }
                .padding(.horizontal, 14).padding(.vertical, 10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: 12))
            }
            .onChange(of: pickerItems) { _, items in
                guard !items.isEmpty else { return }
                Task { await uploadItems(items) }
            }

            // Preview thumbnails
            if !uploadedURLs.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(uploadedURLs, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Theme.surfaceElevated)
                                .frame(width: 56, height: 56)
                                .overlay(
                                    Image(systemName: "photo.fill")
                                        .foregroundStyle(Theme.textTertiary)
                                )
                        }
                    }
                }
            }
        }
    }

    private func uploadItems(_ items: [PhotosPickerItem]) async {
        isUploading = true
        defer { isUploading = false; pickerItems = [] }
        for item in items {
            guard let data = try? await item.loadTransferable(type: Data.self) else { continue }
            do {
                let resp = try await UploadService.uploadImage(data, filename: "job_\(UUID().uuidString).jpg",
                                                               purpose: purpose)
                uploadedURLs.append(resp.url)
            } catch {
                NSLog("[ImagePicker] upload failed: \(error)")
            }
        }
    }
}

// MARK: - Profile photo picker (single image, immediate upload)

struct ProfilePhotoPicker: View {
    let currentURL: String?
    var onUpload: (String) -> Void

    @State private var pickerItem: PhotosPickerItem?
    @State private var isUploading = false

    var body: some View {
        PhotosPicker(selection: $pickerItem, matching: .images) {
            ZStack(alignment: .bottomTrailing) {
                Circle()
                    .fill(Theme.accentSoft)
                    .frame(width: 80, height: 80)
                    .overlay(
                        Image(systemName: "person.fill")
                            .font(.system(size: 32, weight: .light))
                            .foregroundStyle(Theme.accent)
                    )
                ZStack {
                    Circle().fill(Theme.accent).frame(width: 26, height: 26)
                    if isUploading {
                        ProgressView().tint(.white).scaleEffect(0.6)
                    } else {
                        Image(systemName: "camera.fill")
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.white)
                    }
                }
                .offset(x: 4, y: 4)
            }
        }
        .onChange(of: pickerItem) { _, item in
            guard let item else { return }
            Task {
                isUploading = true
                defer { isUploading = false }
                guard let data = try? await item.loadTransferable(type: Data.self) else { return }
                do {
                    let resp = try await UploadService.uploadImage(data, filename: "avatar.jpg",
                                                                   purpose: "profile_photo")
                    onUpload(resp.url)
                } catch {
                    NSLog("[ProfilePhoto] upload failed: \(error)")
                }
            }
        }
    }
}
