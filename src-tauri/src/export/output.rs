//! Export output is staged beside its destination; a failed write must leave
//! the previous user file intact. Copying PDFs never loads the whole file.
use std::{fs::File, io::{self, Read}, path::Path};
use tempfile::NamedTempFile;

pub fn create(destination: &Path) -> Result<NamedTempFile, String> {
    let directory = destination.parent().filter(|path| !path.as_os_str().is_empty()).unwrap_or(Path::new("."));
    tempfile::Builder::new().prefix(".nb-export-").tempfile_in(directory).map_err(|error| error.to_string())
}

pub fn publish(output: NamedTempFile, destination: &Path) -> Result<(), String> {
    // Reopen by path because an external converter may have replaced its temp
    // output inode. Sync the file that will actually be atomically published.
    let file = std::fs::OpenOptions::new().write(true).open(output.path()).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    drop(file);
    output.persist(destination).map_err(|error| error.to_string())?;
    Ok(())
}

fn copy_reader(source: &mut impl Read, destination: &Path) -> Result<(), String> {
    let mut output = create(destination)?;
    io::copy(source, &mut output).map_err(|error| error.to_string())?;
    publish(output, destination)
}

pub fn copy(source: &Path, destination: &Path) -> Result<(), String> {
    copy_reader(&mut File::open(source).map_err(|error| error.to_string())?, destination)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FailsAfterChunk(bool);
    impl Read for FailsAfterChunk {
        fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
            if self.0 { return Err(io::Error::other("copy interrupted")); }
            self.0 = true; target[0] = b'x'; Ok(1)
        }
    }

    #[test]
    fn interrupted_copy_preserves_existing_destination_and_removes_temp() {
        let directory = tempfile::tempdir().unwrap(); let destination = directory.path().join("saved.pdf");
        std::fs::write(&destination, b"original PDF").unwrap();
        assert!(copy_reader(&mut FailsAfterChunk(false), &destination).is_err());
        assert_eq!(std::fs::read(&destination).unwrap(), b"original PDF");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }

    #[test]
    fn completed_copy_atomically_replaces_destination() {
        let directory = tempfile::tempdir().unwrap(); let destination = directory.path().join("saved.pdf");
        std::fs::write(&destination, b"original PDF").unwrap();
        copy_reader(&mut &b"replacement PDF"[..], &destination).unwrap();
        assert_eq!(std::fs::read(&destination).unwrap(), b"replacement PDF");
        assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 1);
    }
}
