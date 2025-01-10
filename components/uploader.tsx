'use client'

import { useState, type FormEvent } from 'react'
import toast from 'react-hot-toast'
import { upload } from '@vercel/blob/client'
import imageCompression from 'browser-image-compression'
import ProgressBar from './progress-bar'

interface FileWithPath extends File {
  readonly webkitRelativePath: string;
  customPath?: string;
}

const compressionOptions = {
  maxSizeMB: 1,
  maxWidthOrHeight: 1920,
  useWebWorker: true,
  fileType: 'image/jpeg'
}

export default function Uploader() {
  const [files, setFiles] = useState<FileWithPath[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [folderName, setFolderName] = useState<string>('')

  function reset() {
    setIsUploading(false)
    setFiles([])
    setFolderName('')
  }

  async function compressImage(file: File): Promise<File> {
    try {
      // Only compress if it's an image
      if (file.type.startsWith('image/')) {
        const compressedFile = await imageCompression(file, compressionOptions)
        // Preserve the original name
        return new File([compressedFile], file.name, { type: compressedFile.type })
      }
    } catch (error) {
      console.warn('Compression failed for', file.name, error)
    }
    // Return original file if compression fails or if it's not an image
    return file
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setIsUploading(true)

    if (files.length > 0) {
      try {
        // Compress images before upload
        const compressedFiles = await Promise.all(
          files.map(async (file) => {
            const compressed = await compressImage(file)
            // Create a new object with the compressed file and path
            return Object.assign(compressed, { 
              customPath: file.customPath || file.webkitRelativePath || `${folderName}/${file.name}`
            }) as FileWithPath
          })
        )

        // Upload all files in parallel
        const uploads = await Promise.all(
          compressedFiles.map(async (file, index) => {
            // Use the custom path or fallback to the relative path
            const uploadPath = file.customPath || `${folderName}/${file.name}`
            const blob = await upload(uploadPath, file, {
              access: 'public',
              handleUploadUrl: '/api/upload',
              onUploadProgress: (progressEvent) => {
                // Calculate overall progress across all files
                const singleFileContribution = progressEvent.percentage / files.length
                const baseProgress = (index * 100) / files.length
                setProgress(baseProgress + singleFileContribution)
              },
            })
            return blob
          })
        )

        toast(
          (t: { id: string }) => (
            <div className="relative">
              <div className="p-2">
                <p className="font-semibold text-gray-900">Folder uploaded!</p>
                <p className="mt-1 text-sm text-gray-500">
                  {folderName} ({files.length} files) has been uploaded successfully
                </p>
              </div>
            </div>
          ),
          { duration: Number.POSITIVE_INFINITY }
        )
      } catch (error) {
        if (error instanceof Error) {
          toast.error(error.message)
        } else {
          throw error
        }
      }

      reset()
    }
  }

  function handleFolderChange(fileList: FileList | null) {
    toast.dismiss()
    if (!fileList) return

    const newFiles = Array.from(fileList) as FileWithPath[]
    
    // Validate total size
    const totalSize = newFiles.reduce((acc, file) => acc + file.size, 0)
    if (totalSize / 1024 / 1024 > 500) {
      toast.error('Total folder size too big (max 500MB)')
      return
    }

    // Extract folder name from the first file's path
    if (newFiles.length > 0) {
      const path = newFiles[0].webkitRelativePath
      const folderName = path.split('/')[0]
      setFolderName(folderName)
    }

    setFiles(newFiles)
  }

  async function processDroppedFolder(entry: FileSystemDirectoryEntry) {
    const fileList: FileWithPath[] = []
    const baseFolderName = entry.name

    async function readDirectory(dirEntry: FileSystemDirectoryEntry, path: string) {
      const reader = dirEntry.createReader()
      const entries: FileSystemEntry[] = await new Promise((resolve) => {
        reader.readEntries((entries) => resolve(entries))
      })

      for (const entry of entries) {
        if (entry.isFile) {
          const file: File = await new Promise((resolve) => {
            (entry as FileSystemFileEntry).file((file) => resolve(file))
          })
          // Create a new file with custom path
          const fileWithPath = file as FileWithPath
          fileWithPath.customPath = `${path}/${file.name}`
          fileList.push(fileWithPath)
        } else if (entry.isDirectory) {
          await readDirectory(entry as FileSystemDirectoryEntry, `${path}/${entry.name}`)
        }
      }
    }

    await readDirectory(entry, baseFolderName)
    setFolderName(baseFolderName)
    
    if (fileList.length > 0) {
      setFiles(fileList)
    }
  }

  return (
    <form className="grid gap-6" onSubmit={handleSubmit}>
      <div>
        <div className="space-y-1 mb-4">
          <h2 className="text-xl font-semibold">Upload a folder</h2>
        </div>
        <label
          htmlFor="folder-upload"
          className="group relative mt-2 flex h-72 cursor-pointer flex-col items-center justify-center rounded-md border border-gray-300 bg-white shadow-sm transition-all hover:bg-gray-50"
        >
          <div
            className="absolute z-[5] h-full w-full rounded-md"
            onDragOver={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragActive(true)
            }}
            onDragEnter={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragActive(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragActive(false)
            }}
            onDrop={(e) => {
              e.preventDefault()
              e.stopPropagation()
              setDragActive(false)

              const items = e.dataTransfer?.items
              if (items) {
                const entries = Array.from(items)
                  .filter(item => item.kind === 'file')
                  .map(item => item.webkitGetAsEntry())
                  .filter((entry): entry is FileSystemDirectoryEntry => entry !== null && entry.isDirectory)

                if (entries.length > 0) {
                  processDroppedFolder(entries[0])
                }
              }
            }}
          />
          <div
            className={`${
              dragActive ? 'border-2 border-black' : ''
            } absolute z-[3] flex h-full w-full flex-col items-center justify-center rounded-md px-10 transition-all ${
              files.length > 0
                ? 'bg-white/80 opacity-0 hover:opacity-100 hover:backdrop-blur-md'
                : 'bg-white opacity-100 hover:bg-gray-50'
            }`}
          >
            <svg
              className={`${
                dragActive ? 'scale-110' : 'scale-100'
              } h-7 w-7 text-gray-500 transition-all duration-75 group-hover:scale-110 group-active:scale-95`}
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <title>Upload icon</title>
              <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" />
              <path d="M12 12v9" />
              <path d="m16 16-4-4-4 4" />
            </svg>
            <p className="mt-2 text-center text-sm text-gray-500">
              Drag and drop a folder or click to upload.
            </p>
            <p className="mt-2 text-center text-sm text-gray-500">
              Max folder size: 500MB
            </p>
            {files.length > 0 && (
              <p className="mt-2 text-center text-sm text-gray-500">
                {folderName} ({files.length} files selected)
              </p>
            )}
            <span className="sr-only">Folder upload</span>
          </div>
        </label>
        <div className="mt-1 flex rounded-md shadow-sm">
          <input
            id="folder-upload"
            name="folder"
            type="file"
            // @ts-ignore -- webkitdirectory and directory are valid attributes for file input but not typed in React
            webkitdirectory=""
            directory=""
            className="sr-only"
            onChange={(event) => {
              handleFolderChange(event.currentTarget?.files)
            }}
          />
        </div>
      </div>

      <div className="space-y-2">
        {isUploading && <ProgressBar value={progress} />}

        <button
          type="submit"
          disabled={isUploading || files.length === 0}
          className="border-black bg-black text-white hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 flex h-10 w-full items-center justify-center rounded-md border text-sm transition-all focus:outline-none"
        >
          <p className="text-sm">Upload Folder</p>
        </button>

        <button
          type="reset"
          onClick={reset}
          disabled={isUploading || files.length === 0}
          className="border-gray-200 bg-gray-100 text-gray-700 hover:bg-white hover:text-black disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400 flex h-10 w-full items-center justify-center rounded-md border text-sm transition-all focus:outline-none"
        >
          Reset
        </button>
      </div>
    </form>
  )
}
