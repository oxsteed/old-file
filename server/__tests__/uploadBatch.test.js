'use strict';

jest.mock('../utils/storage', () => ({
  uploadFile: jest.fn(),
  deleteFile: jest.fn(),
}));

const storage = require('../utils/storage');
const { uploadFilesOrThrow } = require('../utils/uploadBatch');

const files = (names) => names.map((originalname) => ({
  originalname,
  mimetype: 'image/jpeg',
  buffer: Buffer.from(originalname),
}));

describe('uploadFilesOrThrow', () => {
  beforeEach(() => {
    storage.uploadFile.mockReset();
    storage.deleteFile.mockReset().mockResolvedValue(undefined);
  });

  test('returns all keys for a successful bounded batch', async () => {
    storage.uploadFile.mockImplementation(async (_buffer, prefix, name) => `${prefix}/${name}`);

    await expect(uploadFilesOrThrow(files(['one.jpg', 'two.jpg']), 'intakes')).resolves.toEqual([
      'intakes/one.jpg',
      'intakes/two.jpg',
    ]);
    expect(storage.deleteFile).not.toHaveBeenCalled();
  });

  test('rolls back successful uploads and reports every failed file', async () => {
    storage.uploadFile
      .mockResolvedValueOnce('intakes/one.jpg')
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValueOnce('intakes/three.jpg');

    await expect(uploadFilesOrThrow(files(['one.jpg', 'two.jpg', 'three.jpg']), 'intakes', {
      code: 'intake_media_upload_failed',
      label: 'intake photo',
    })).rejects.toMatchObject({
      status: 502,
      code: 'intake_media_upload_failed',
      fields: { failedFiles: ['two.jpg'], totalFiles: 3 },
    });
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
    expect(storage.deleteFile).toHaveBeenCalledWith('intakes/one.jpg');
    expect(storage.deleteFile).toHaveBeenCalledWith('intakes/three.jpg');
  });

  test('limits the batch to five files', async () => {
    storage.uploadFile.mockImplementation(async (_buffer, prefix, name) => `${prefix}/${name}`);
    await uploadFilesOrThrow(files(['1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg']), 'intakes');
    expect(storage.uploadFile).toHaveBeenCalledTimes(5);
  });
});
